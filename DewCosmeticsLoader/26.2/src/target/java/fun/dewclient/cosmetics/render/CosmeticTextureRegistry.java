package fun.dewclient.cosmetics.render;

import com.mojang.blaze3d.platform.NativeImage;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.core.ClientAsset;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.PlayerSkin;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Registers verified cosmetic images on the render thread and maps them by player UUID. */
public final class CosmeticTextureRegistry {
    public static final class DownloadedAsset {
        private final String type;
        private final String sha256;
        private final String contentType;
        private final byte[] bytes;

        public DownloadedAsset(String type, String sha256, byte[] bytes) {
            this(type, sha256, "image/png", bytes);
        }

        public DownloadedAsset(String type, String sha256, String contentType, byte[] bytes) {
            this.type = type;
            this.sha256 = sha256;
            this.contentType = contentType;
            this.bytes = bytes;
        }

        public String getType() { return type; }
        public String getSha256() { return sha256; }
        public String getContentType() { return contentType; }
        public byte[] getBytes() { return bytes; }
    }

    public static final class PlayerCosmetics {
        private final UUID playerUuid;
        private final List<DownloadedAsset> assets;

        public PlayerCosmetics(UUID playerUuid, List<DownloadedAsset> assets) {
            this.playerUuid = playerUuid;
            this.assets = new ArrayList<DownloadedAsset>(assets);
        }
    }

    public static final class OwnedCapeAsset {
        public final String assetId;
        public final String sha256;
        public final String contentType;
        public final byte[] bytes;

        public OwnedCapeAsset(String assetId, String sha256, byte[] bytes) {
            this(assetId, sha256, "image/png", bytes);
        }

        public OwnedCapeAsset(String assetId, String sha256, String contentType, byte[] bytes) {
            this.assetId = assetId;
            this.sha256 = sha256;
            this.contentType = contentType;
            this.bytes = bytes;
        }
    }

    private static final class TextureAsset implements ClientAsset.Texture {
        private final Identifier id;
        private final Identifier texturePath;

        private TextureAsset(Identifier id) {
            this.id = id;
            this.texturePath = id;
        }

        @Override
        public Identifier id() {
            return id;
        }

        @Override
        public Identifier texturePath() {
            return texturePath;
        }
    }

    private static volatile Map<String, ClientAsset.Texture> activeTextures = Collections.emptyMap();
    private static volatile Map<String, ClientAsset.Texture> baseLocalTextures = Collections.emptyMap();
    private static volatile Map<String, ClientAsset.Texture> ownedCapeTextures = Collections.emptyMap();
    private static volatile Map<String, ClientAsset.Texture> microsoftCapeTextures = Collections.emptyMap();
    private static volatile String selectedOwnedCapeAssetId;
    private static volatile String defaultMicrosoftCapeId;
    private static volatile String selectedMicrosoftCapeId;
    private static volatile Map<UUID, Map<String, ClientAsset.Texture>> remotePlayerTextures = Collections.emptyMap();
    private static Map<Identifier, ClientAsset.Texture> registeredRemoteTextures = Collections.emptyMap();

    private CosmeticTextureRegistry() {
    }

    /** Install the launched DewClient user's own local cosmetics. Must run on Minecraft's render thread. */
    public static int install(List<DownloadedAsset> downloadedAssets) {
        Minecraft client = Minecraft.getInstance();
        Map<String, ClientAsset.Texture> nextTextures = new HashMap<String, ClientAsset.Texture>();
        for (DownloadedAsset asset : downloadedAssets) {
            if (asset == null || nextTextures.containsKey(asset.type)) continue;
            TextureAsset registered = register(client, asset, "dynamic/" + asset.sha256);
            if (registered != null) nextTextures.put(asset.type, registered);
        }
        baseLocalTextures = Collections.unmodifiableMap(nextTextures);
        applySelectedCape(client);
        return nextTextures.size();
    }

    /** Install cape textures the authenticated player owns, then apply the server-selected one. */
    public static int installOwnedCapes(List<OwnedCapeAsset> capes, String selectedAssetId) {
        Minecraft client = Minecraft.getInstance();
        Map<String, ClientAsset.Texture> next = new HashMap<String, ClientAsset.Texture>();
        if (capes != null) {
            for (OwnedCapeAsset cape : capes) {
                if (cape == null || cape.assetId == null || !cape.assetId.matches("[a-f0-9]{64}")
                        || next.containsKey(cape.assetId)) continue;
                TextureAsset texture = register(client,
                        new DownloadedAsset("cape", cape.sha256, cape.bytes), "owned/capes/" + cape.assetId);
                if (texture != null) next.put(cape.assetId, texture);
            }
        }
        Set<Identifier> kept = new HashSet<Identifier>();
        for (ClientAsset.Texture texture : next.values()) kept.add(texture.id());
        for (ClientAsset.Texture texture : ownedCapeTextures.values()) {
            if (!kept.contains(texture.id())) client.getTextureManager().release(texture.id());
        }
        ownedCapeTextures = Collections.unmodifiableMap(next);
        selectedOwnedCapeAssetId = selectedAssetId;
        selectedMicrosoftCapeId = selectedAssetId == null ? defaultMicrosoftCapeId : null;
        applySelectedCape(client);
        return next.size();
    }

    public static int installMicrosoftCapes(List<OwnedCapeAsset> capes, String activeAssetId) {
        Minecraft client = Minecraft.getInstance();
        Map<String, ClientAsset.Texture> next = new HashMap<String, ClientAsset.Texture>();
        if (capes != null) {
            for (OwnedCapeAsset cape : capes) {
                if (cape == null || cape.assetId == null || !cape.assetId.matches("[a-f0-9]{64}")
                        || next.containsKey(cape.assetId)) continue;
                TextureAsset texture = register(client,
                        new DownloadedAsset("cape", cape.sha256, cape.bytes), "microsoft/capes/" + cape.assetId);
                if (texture != null) next.put(cape.assetId, texture);
            }
        }
        Set<Identifier> kept = new HashSet<Identifier>();
        for (ClientAsset.Texture texture : next.values()) kept.add(texture.id());
        for (ClientAsset.Texture texture : microsoftCapeTextures.values()) {
            if (!kept.contains(texture.id())) client.getTextureManager().release(texture.id());
        }
        microsoftCapeTextures = Collections.unmodifiableMap(next);
        defaultMicrosoftCapeId = activeAssetId != null && next.containsKey(activeAssetId) ? activeAssetId : null;
        if (selectedOwnedCapeAssetId == null) selectedMicrosoftCapeId = defaultMicrosoftCapeId;
        applySelectedCape(client);
        return next.size();
    }

    public static boolean selectMicrosoftCape(String assetId) {
        if (assetId != null && !microsoftCapeTextures.containsKey(assetId)) return false;
        selectedOwnedCapeAssetId = null;
        selectedMicrosoftCapeId = assetId;
        applySelectedCape(Minecraft.getInstance());
        return true;
    }

    /** Select a collection cape locally; a null ID restores the launcher's default cape. */
    public static boolean selectOwnedCape(String assetId) {
        if (assetId != null && !ownedCapeTextures.containsKey(assetId)) return false;
        selectedOwnedCapeAssetId = assetId;
        selectedMicrosoftCapeId = assetId == null ? defaultMicrosoftCapeId : null;
        applySelectedCape(Minecraft.getInstance());
        return true;
    }

    private static void applySelectedCape(Minecraft client) {
        Map<String, ClientAsset.Texture> next = new HashMap<String, ClientAsset.Texture>(baseLocalTextures);
        if (selectedMicrosoftCapeId != null && microsoftCapeTextures.containsKey(selectedMicrosoftCapeId)) {
            next.put("cape", microsoftCapeTextures.get(selectedMicrosoftCapeId));
        } else if (selectedOwnedCapeAssetId != null) {
            ClientAsset.Texture selected = ownedCapeTextures.get(selectedOwnedCapeAssetId);
            if (selected != null) next.put("cape", selected);
        }
        releaseUnused(client, activeTextures, next);
        activeTextures = Collections.unmodifiableMap(next);
    }

    /** Replace all visible remote player textures. Must run on Minecraft's render thread. */
    public static int installPlayers(List<PlayerCosmetics> players) {
        Minecraft client = Minecraft.getInstance();
        Map<Identifier, ClientAsset.Texture> nextRegistered = new HashMap<Identifier, ClientAsset.Texture>();
        Map<UUID, Map<String, ClientAsset.Texture>> nextPlayers = new HashMap<UUID, Map<String, ClientAsset.Texture>>();
        int installed = 0;

        for (PlayerCosmetics player : players) {
            if (player == null || player.playerUuid == null) continue;
            Map<String, ClientAsset.Texture> textures = new HashMap<String, ClientAsset.Texture>();
            for (DownloadedAsset asset : player.assets) {
                if (asset == null || textures.containsKey(asset.type)) continue;
                Identifier id = remoteTextureId(asset);
                ClientAsset.Texture texture = registeredRemoteTextures.get(id);
                if (texture == null) texture = nextRegistered.get(id);
                if (texture == null) texture = register(client, asset, "assigned/" + asset.type + "/" + asset.sha256);
                if (texture != null) {
                    nextRegistered.put(id, texture);
                    textures.put(asset.type, texture);
                    installed++;
                }
            }
            if (!textures.isEmpty()) nextPlayers.put(player.playerUuid, Collections.unmodifiableMap(textures));
        }

        Set<Identifier> keptIds = new HashSet<Identifier>(nextRegistered.keySet());
        for (Identifier previousId : registeredRemoteTextures.keySet()) {
            if (!keptIds.contains(previousId)) client.getTextureManager().release(previousId);
        }
        registeredRemoteTextures = Collections.unmodifiableMap(nextRegistered);
        remotePlayerTextures = Collections.unmodifiableMap(nextPlayers);
        return installed;
    }

    public static PlayerSkin applyLocalPlayer(PlayerSkin original) {
        return apply(original, activeTextures);
    }

    public static PlayerSkin applyRemotePlayer(UUID playerUuid, PlayerSkin original) {
        return apply(original, remotePlayerTextures.get(playerUuid));
    }

    public static boolean hasRemoteCosmetics(UUID playerUuid) {
        Map<String, ClientAsset.Texture> textures = remotePlayerTextures.get(playerUuid);
        return textures != null && !textures.isEmpty();
    }

    private static PlayerSkin apply(PlayerSkin original, Map<String, ClientAsset.Texture> textures) {
        if (textures == null || textures.isEmpty()) return original;
        ClientAsset.Texture body = textures.getOrDefault("skin", original.body());
        ClientAsset.Texture cape = textures.getOrDefault("cape", original.cape());
        ClientAsset.Texture elytra = textures.getOrDefault("wings", original.elytra());
        if (body == original.body() && cape == original.cape() && elytra == original.elytra()) return original;
        return new PlayerSkin(body, cape, elytra, original.model(), original.secure());
    }

    private static TextureAsset register(Minecraft client, DownloadedAsset asset, String path) {
        if (!isSupportedType(asset.type) || asset.sha256 == null || !asset.sha256.matches("[a-f0-9]{64}")
                || asset.bytes == null || asset.bytes.length == 0 || asset.bytes.length > 50 * 1024 * 1024) {
            return null;
        }
        NativeImage image = null;
        try {
            image = NativeImage.read(asset.bytes);
            if (!validDimensions(asset.type, image.getWidth(), image.getHeight())) return null;
            Identifier textureId = Identifier.fromNamespaceAndPath("dewcosmetics", path);
            client.getTextureManager().register(textureId,
                    new DynamicTexture(() -> "DewCosmetics " + asset.type, image));
            image = null;
            return new TextureAsset(textureId);
        } catch (IOException | RuntimeException error) {
            System.err.println("[DewCosmetics] Ignored invalid " + asset.type + " texture.");
            return null;
        } finally {
            if (image != null) image.close();
        }
    }

    private static Identifier remoteTextureId(DownloadedAsset asset) {
        return Identifier.fromNamespaceAndPath("dewcosmetics", "assigned/" + asset.type + "/" + asset.sha256);
    }

    private static void releaseUnused(Minecraft client, Map<String, ClientAsset.Texture> oldTextures,
                                      Map<String, ClientAsset.Texture> nextTextures) {
        Set<Identifier> retained = new HashSet<Identifier>();
        for (ClientAsset.Texture texture : nextTextures.values()) retained.add(texture.id());
        for (ClientAsset.Texture texture : oldTextures.values()) {
            if (!retained.contains(texture.id())) client.getTextureManager().release(texture.id());
        }
    }

    private static boolean isSupportedType(String type) {
        return "skin".equals(type) || "cape".equals(type) || "wings".equals(type);
    }

    private static boolean validDimensions(String type, int width, int height) {
        if (!(width == 64 || width == 128 || width == 256 || width == 512 || width == 1024 || width == 2048)
                || height < 32 || height > 1024) return false;
        if ("skin".equals(type)) {
            return height == width || height == width / 2;
        }
        if ("cape".equals(type)) {
            return width == height * 2;
        }
        return "wings".equals(type) && width == height * 2;
    }
}
