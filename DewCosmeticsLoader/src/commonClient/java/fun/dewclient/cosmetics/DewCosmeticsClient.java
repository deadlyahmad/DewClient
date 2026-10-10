package fun.dewclient.cosmetics;

import fun.dewclient.cosmetics.bridge.BridgeClient;
import fun.dewclient.cosmetics.bridge.BridgeConfig;
import fun.dewclient.cosmetics.remote.RemoteCosmeticsClient;
import fun.dewclient.cosmetics.render.CosmeticTextureRegistry;
import net.minecraft.client.Minecraft;
import net.fabricmc.api.ClientModInitializer;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class DewCosmeticsClient implements ClientModInitializer {
    private static final ExecutorService BOOTSTRAP_EXECUTOR = Executors.newSingleThreadExecutor(new ThreadFactory() {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "DewCosmetics-Bridge");
            thread.setDaemon(true);
            return thread;
        }
    });
    private static final ScheduledExecutorService BRIDGE_REFRESH_EXECUTOR = Executors.newSingleThreadScheduledExecutor(new ThreadFactory() {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "DewCosmetics-Bridge-Refresh");
            thread.setDaemon(true);
            return thread;
        }
    });
    private static final AtomicBoolean BRIDGE_REFRESH_IN_FLIGHT = new AtomicBoolean(false);
    private static volatile String appliedBridgeSignature = "";

    @Override
    public void onInitializeClient() {
        BOOTSTRAP_EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final BridgeConfig config = BridgeClient.fetchLaunchConfig();
                    if (config == null) {
                        System.out.println("[DewCosmetics] No DewClient bridge configured; continuing without cosmetics.");
                        return;
                    }
                    appliedBridgeSignature = signature(config);

                    final List<CosmeticTextureRegistry.DownloadedAsset> downloadedAssets = downloadAssets(config);
                    final List<CosmeticTextureRegistry.OwnedCapeAsset> microsoftCapeTextures = downloadMicrosoftCapes(config);
                    final List<RemoteCosmeticsClient.CapeChoice> microsoftCapeChoices = capeChoices(config);
                    final String activeCapeId = activeMicrosoftCapeId(config);

                    Minecraft.getInstance().execute(new Runnable() {
                        @Override
                        public void run() {
                            int installed = CosmeticTextureRegistry.install(downloadedAssets);
                            RemoteCosmeticsClient.installMicrosoftCapes(microsoftCapeChoices, microsoftCapeTextures, activeCapeId);
                            System.out.println("[DewCosmetics] Installed " + installed
                                    + " local cosmetic textures from revision " + config.getRevision() + ".");
                            if (config.getApiBaseUrl() != null) {
                                RemoteCosmeticsClient.start(config.getApiBaseUrl(), config.getApiAccessToken());
                                RemoteCosmeticsClient.publishOwnCosmetics(downloadedAssets);
                            } else {
                                System.out.println("[DewCosmetics] Shared cosmetics are unavailable because remote sync is disabled.");
                            }
                            BRIDGE_REFRESH_EXECUTOR.scheduleWithFixedDelay(new Runnable() {
                                @Override
                                public void run() {
                                    refreshBridgeSnapshot();
                                }
                            }, 8L, 8L, TimeUnit.SECONDS);
                        }
                    });
                } catch (Exception error) {
                    System.err.println("[DewCosmetics] Bridge unavailable or invalid; continuing without cosmetics: "
                            + error.getMessage());
                }
            }
        });
    }

    private static void refreshBridgeSnapshot() {
        if (!BRIDGE_REFRESH_IN_FLIGHT.compareAndSet(false, true)) return;
        try {
            BridgeConfig config = BridgeClient.fetchLaunchConfig();
            if (config == null) return;
            String nextSignature = signature(config);
            if (nextSignature.equals(appliedBridgeSignature)) return;

            List<CosmeticTextureRegistry.DownloadedAsset> downloadedAssets = downloadAssets(config);
            List<CosmeticTextureRegistry.OwnedCapeAsset> microsoftCapeTextures = downloadMicrosoftCapes(config);
            List<RemoteCosmeticsClient.CapeChoice> microsoftCapeChoices = capeChoices(config);
            String activeCapeId = activeMicrosoftCapeId(config);
            Minecraft.getInstance().execute(() -> {
                CosmeticTextureRegistry.install(downloadedAssets);
                RemoteCosmeticsClient.installMicrosoftCapes(microsoftCapeChoices, microsoftCapeTextures, activeCapeId);
                RemoteCosmeticsClient.publishOwnCosmetics(downloadedAssets);
                appliedBridgeSignature = nextSignature;
                System.out.println("[DewCosmetics] Applied updated DewClient cosmetics.");
            });
        } catch (Exception error) {
            // A transient bridge error should leave the last working textures installed.
        } finally {
            BRIDGE_REFRESH_IN_FLIGHT.set(false);
        }
    }

    private static List<CosmeticTextureRegistry.DownloadedAsset> downloadAssets(BridgeConfig config) {
        List<CosmeticTextureRegistry.DownloadedAsset> downloadedAssets = new ArrayList<CosmeticTextureRegistry.DownloadedAsset>();
        for (BridgeConfig.CosmeticAsset asset : config.getAssets()) {
            try {
                downloadedAssets.add(new CosmeticTextureRegistry.DownloadedAsset(
                        asset.getType(), asset.getSha256(), asset.getMime(), BridgeClient.fetchAsset(asset)));
            } catch (IOException error) {
                System.err.println("[DewCosmetics] Could not load " + asset.getType() + " texture.");
            }
        }
        return downloadedAssets;
    }

    private static List<CosmeticTextureRegistry.OwnedCapeAsset> downloadMicrosoftCapes(BridgeConfig config) {
        List<CosmeticTextureRegistry.OwnedCapeAsset> textures = new ArrayList<CosmeticTextureRegistry.OwnedCapeAsset>();
        for (BridgeConfig.MicrosoftCape cape : config.getMicrosoftCapes()) {
            try {
                textures.add(new CosmeticTextureRegistry.OwnedCapeAsset(cape.getId(), cape.getSha256(), cape.getMime(), BridgeClient.fetchAsset(cape)));
            } catch (IOException error) {
                System.err.println("[DewCosmetics] Could not load an official Microsoft cape texture.");
            }
        }
        return textures;
    }

    private static List<RemoteCosmeticsClient.CapeChoice> capeChoices(BridgeConfig config) {
        List<RemoteCosmeticsClient.CapeChoice> choices = new ArrayList<RemoteCosmeticsClient.CapeChoice>();
        for (BridgeConfig.MicrosoftCape cape : config.getMicrosoftCapes()) {
            choices.add(RemoteCosmeticsClient.createMicrosoftCapeChoice(cape.getId(), cape.getName(), cape.isActive()));
        }
        return choices;
    }

    private static String activeMicrosoftCapeId(BridgeConfig config) {
        for (BridgeConfig.MicrosoftCape cape : config.getMicrosoftCapes()) {
            if (cape.isActive()) return cape.getId();
        }
        return null;
    }

    private static String signature(BridgeConfig config) {
        StringBuilder value = new StringBuilder().append(config.getRevision());
        for (BridgeConfig.CosmeticAsset asset : config.getAssets()) {
            value.append('|').append(asset.getType()).append(':').append(asset.getSha256());
        }
        for (BridgeConfig.MicrosoftCape cape : config.getMicrosoftCapes()) {
            value.append('|').append(cape.getId()).append(':').append(cape.isActive());
        }
        return value.toString();
    }
}
