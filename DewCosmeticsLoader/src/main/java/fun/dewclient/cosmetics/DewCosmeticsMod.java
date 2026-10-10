package fun.dewclient.cosmetics;

import fun.dewclient.cosmetics.bridge.BridgeClient;
import fun.dewclient.cosmetics.bridge.BridgeConfig;
import net.fabricmc.api.ClientModInitializer;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

public final class DewCosmeticsMod implements ClientModInitializer {
    private static final ExecutorService BOOTSTRAP_EXECUTOR = Executors.newSingleThreadExecutor(new ThreadFactory() {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "DewCosmetics-Bridge");
            thread.setDaemon(true);
            return thread;
        }
    });

    @Override
    public void onInitializeClient() {
        BOOTSTRAP_EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    BridgeConfig config = BridgeClient.fetchLaunchConfig();
                    if (config == null) {
                        System.out.println("[DewCosmetics] No DewClient bridge configured; continuing without cosmetics.");
                        return;
                    }
                    System.out.println("[DewCosmetics] Loaded launch snapshot revision " + config.getRevision()
                            + " with " + config.getEquippedCosmeticIds().size() + " equipped cosmetics.");
                } catch (Exception error) {
                    System.err.println("[DewCosmetics] Bridge unavailable or invalid; continuing without cosmetics: "
                            + error.getMessage());
                }
            }
        });
    }
}