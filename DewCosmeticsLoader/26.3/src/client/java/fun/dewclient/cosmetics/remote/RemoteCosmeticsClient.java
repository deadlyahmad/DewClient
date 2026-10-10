package fun.dewclient.cosmetics.remote;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import fun.dewclient.cosmetics.render.CosmeticTextureRegistry;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Fetches bounded, public assigned cosmetics for other currently visible players. */
public final class RemoteCosmeticsClient {
    private static final int MAX_PLAYERS_PER_REQUEST = 128;
    private static final int MAX_JSON_BYTES = 512 * 1024;
    private static final int MAX_ASSET_BYTES = 50 * 1024 * 1024;
    private static final long MAX_BATCH_ASSET_BYTES = 128L * 1024L * 1024L;
    private static final long MAX_CACHED_ASSET_BYTES = 128L * 1024L * 1024L;
    private static final long REFRESH_INTERVAL_MS = 10_000L;
    private static final ExecutorService NETWORK_EXECUTOR = Executors.newSingleThreadExecutor(new ThreadFactory() {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "DewCosmetics-Players");
            thread.setDaemon(true);
            return thread;
        }
    });
    private static final AtomicBoolean REQUEST_IN_FLIGHT = new AtomicBoolean(false);
    private static final AtomicBoolean CAPE_REFRESH_IN_FLIGHT = new AtomicBoolean(false);
    private static final AtomicBoolean OWN_PUBLISH_IN_FLIGHT = new AtomicBoolean(false);
    private static final Map<String, byte[]> ASSET_CACHE = new LinkedHashMap<String, byte[]>(64, 0.75f, true);
    private static long cachedAssetBytes;

    private static volatile String apiBaseUrl;
    private static volatile String accessToken;
    private static volatile List<CapeChoice> capeChoices = Collections.emptyList();
    private static volatile List<CapeChoice> microsoftCapeChoices = Collections.emptyList();
    private static volatile Map<String, CosmeticTextureRegistry.OwnedCapeAsset> microsoftCapeAssets = Collections.emptyMap();
    private static volatile String selectedCapeAssetId;
    private static volatile String activeMicrosoftCapeId;
    private static volatile String capeStatus = "Sign in to a Dew account to load your capes.";
    private static volatile String observedPlayers = "";
    private static volatile long lastRequestAt;
    private static volatile long nextPeriodicRefreshAt;
    private static volatile long retryNotBefore;
    private static volatile long nextOwnCapeRefreshAt;
    private static volatile long nextOwnPublishAt;
    private static volatile String publishedOwnSignature = "";
    private static volatile Map<String, CosmeticTextureRegistry.DownloadedAsset> desiredOwnAssets = Collections.emptyMap();
    private static volatile boolean pendingPlayerChange;
    private static boolean registered;

    private RemoteCosmeticsClient() {
    }

    public static final class CapeChoice {
        public final String assetId;
        public final String name;
        public final String source;
        public final boolean active;

        private CapeChoice(String assetId, String name, String source) { this(assetId, name, source, false); }
        private CapeChoice(String assetId, String name, String source, boolean active) {
            this.assetId = assetId;
            this.name = name;
            this.source = source;
            this.active = active;
        }
    }

    /** Call once on the client thread after the launcher bridge config is parsed. */
    public static synchronized void start(String configuredApiBaseUrl, String configuredAccessToken) {
        if (configuredApiBaseUrl == null || configuredApiBaseUrl.trim().isEmpty()) return;
        String validated = validateBaseUrl(configuredApiBaseUrl);
        if (validated == null) {
            System.err.println("[DewCosmetics] Cross-player cosmetics are unavailable because the API URL is invalid.");
            return;
        }
        String nextAccessToken = configuredAccessToken != null && configuredAccessToken.matches("[A-Za-z0-9_.-]{32,4096}")
                ? configuredAccessToken : null;
        if (!validated.equals(apiBaseUrl) || !java.util.Objects.equals(accessToken, nextAccessToken)) {
            publishedOwnSignature = "";
            nextOwnPublishAt = 0L;
        }
        apiBaseUrl = validated;
        accessToken = nextAccessToken;
        if (!registered) {
            ClientTickEvents.END_CLIENT_TICK.register(RemoteCosmeticsClient::onClientTick);
            registered = true;
        }
        refreshOwnCapes();
    }

    /** Publish the active launcher textures through the account-bound mod session so other DewCosmetics clients can render them. */
    public static void publishOwnCosmetics(List<CosmeticTextureRegistry.DownloadedAsset> assets) {
        Map<String, CosmeticTextureRegistry.DownloadedAsset> next = new LinkedHashMap<String, CosmeticTextureRegistry.DownloadedAsset>();
        if (assets != null) {
            for (CosmeticTextureRegistry.DownloadedAsset asset : assets) {
                if (asset == null) continue;
                String type = asset.getType();
                if ("skin".equals(type) || "cape".equals(type) || "wings".equals(type)) next.put(type, asset);
            }
        }
        if (!next.containsKey("cape") && activeMicrosoftCapeId != null) {
            CosmeticTextureRegistry.OwnedCapeAsset microsoftCape = microsoftCapeAssets.get(activeMicrosoftCapeId);
            if (microsoftCape != null) {
                next.put("cape", new CosmeticTextureRegistry.DownloadedAsset(
                        "cape", microsoftCape.sha256, microsoftCape.contentType, microsoftCape.bytes));
            }
        }
        desiredOwnAssets = Collections.unmodifiableMap(next);
        scheduleOwnCosmeticPublish();
    }

    private static void updateDesiredCape(CosmeticTextureRegistry.OwnedCapeAsset cape) {
        Map<String, CosmeticTextureRegistry.DownloadedAsset> next = new LinkedHashMap<String, CosmeticTextureRegistry.DownloadedAsset>(desiredOwnAssets);
        if (cape == null) {
            next.remove("cape");
        } else {
            next.put("cape", new CosmeticTextureRegistry.DownloadedAsset("cape", cape.sha256, cape.contentType, cape.bytes));
        }
        desiredOwnAssets = Collections.unmodifiableMap(next);
        scheduleOwnCosmeticPublish();
    }

    private static void scheduleOwnCosmeticPublish() {
        if (apiBaseUrl == null || accessToken == null || System.currentTimeMillis() < nextOwnPublishAt) return;
        final Map<String, CosmeticTextureRegistry.DownloadedAsset> snapshot = desiredOwnAssets;
        final String signature = ownAssetsSignature(snapshot);
        if (signature.equals(publishedOwnSignature) || !OWN_PUBLISH_IN_FLIGHT.compareAndSet(false, true)) return;
        NETWORK_EXECUTOR.execute(() -> {
            boolean success = false;
            try {
                publishOneCosmetic("skin", snapshot.get("skin"));
                publishOneCosmetic("cape", snapshot.get("cape"));
                publishOneCosmetic("wings", snapshot.get("wings"));
                publishedOwnSignature = signature;
                nextOwnPublishAt = 0L;
                success = true;
            } catch (Exception error) {
                nextOwnPublishAt = System.currentTimeMillis() + 30_000L;
                System.err.println("[DewCosmetics] Your cosmetics could not be shared with nearby DewClient players yet.");
            } finally {
                OWN_PUBLISH_IN_FLIGHT.set(false);
                if (success && !ownAssetsSignature(desiredOwnAssets).equals(publishedOwnSignature)) {
                    scheduleOwnCosmeticPublish();
                }
            }
        });
    }

    private static String ownAssetsSignature(Map<String, CosmeticTextureRegistry.DownloadedAsset> assets) {
        StringBuilder signature = new StringBuilder();
        for (String type : new String[] {"skin", "cape", "wings"}) {
            CosmeticTextureRegistry.DownloadedAsset asset = assets.get(type);
            signature.append(type).append(':').append(asset == null ? "-" : asset.getSha256()).append('|');
        }
        return signature.toString();
    }

    private static void publishOneCosmetic(String type, CosmeticTextureRegistry.DownloadedAsset asset) throws IOException {
        String contentType = asset == null ? "" : asset.getContentType();
        if (asset != null && !("image/png".equals(contentType) || "image/jpeg".equals(contentType))) {
            throw new IOException("Unsupported active cosmetic texture format.");
        }
        JsonObject request = new JsonObject();
        request.addProperty("kind", type);
        if (asset == null) {
            request.add("asset", JsonNull.INSTANCE);
        } else {
            JsonObject data = new JsonObject();
            data.addProperty("data", Base64.getEncoder().encodeToString(asset.getBytes()));
            data.addProperty("contentType", contentType);
            data.addProperty("sha256", asset.getSha256());
            request.add("asset", data);
        }

        byte[] body = request.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = null;
        try {
            URI uri = URI.create(apiBaseUrl + "/client/cosmetics/presence");
            connection = (HttpURLConnection) uri.toURL().openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(20_000);
            connection.setInstanceFollowRedirects(false);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/json");
            try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("Cosmetics share request was rejected.");
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    public static List<CapeChoice> getCapeChoices() {
        List<CapeChoice> choices = new ArrayList<CapeChoice>(capeChoices);
        choices.addAll(microsoftCapeChoices);
        return choices;
    }
    public static String getSelectedCapeAssetId() { return selectedCapeAssetId; }
    public static String getCapeStatus() { return capeStatus; }

    public static CapeChoice createMicrosoftCapeChoice(String id, String name, boolean active) {
        return new CapeChoice("ms:" + id, name, "microsoft", active);
    }

    public static void installMicrosoftCapes(List<CapeChoice> choices,
            List<CosmeticTextureRegistry.OwnedCapeAsset> textures, String activeAssetId) {
        Map<String, CosmeticTextureRegistry.OwnedCapeAsset> nextAssets = new LinkedHashMap<String, CosmeticTextureRegistry.OwnedCapeAsset>();
        if (textures != null) {
            for (CosmeticTextureRegistry.OwnedCapeAsset texture : textures) {
                if (texture != null && texture.assetId != null) nextAssets.put(texture.assetId, texture);
            }
        }
        microsoftCapeChoices = choices == null ? Collections.emptyList() : Collections.unmodifiableList(new ArrayList<CapeChoice>(choices));
        microsoftCapeAssets = Collections.unmodifiableMap(nextAssets);
        activeMicrosoftCapeId = activeAssetId;
        Minecraft.getInstance().execute(() -> {
            CosmeticTextureRegistry.installMicrosoftCapes(textures, activeAssetId);
            String chosen = activeAssetId;
            if (selectedCapeAssetId == null || selectedCapeAssetId.startsWith("ms:")) {
                if (chosen != null) {
                    CosmeticTextureRegistry.selectMicrosoftCape(chosen);
                    selectedCapeAssetId = "ms:" + chosen;
                }
            }
        });
    }

    public static void refreshOwnCapes() {
        refreshOwnCapes(null);
    }

    public static void refreshOwnCapes(Consumer<Boolean> completion) {
        if (apiBaseUrl == null || accessToken == null) {
            capeStatus = "Sign in with Microsoft or Discord to load DewClient cloud capes.";
            if (completion != null) Minecraft.getInstance().execute(() -> completion.accept(false));
            return;
        }
        if (!CAPE_REFRESH_IN_FLIGHT.compareAndSet(false, true)) {
            if (completion != null) Minecraft.getInstance().execute(() -> completion.accept(false));
            return;
        }
        NETWORK_EXECUTOR.execute(() -> {
            try {
                byte[] response = fetchBytes(apiBaseUrl + "/client/cosmetics/me", "application/json", MAX_JSON_BYTES, null, accessToken);
                JsonObject envelope = new JsonParser().parse(new String(response, StandardCharsets.UTF_8)).getAsJsonObject();
                if (!envelope.has("ok") || !envelope.get("ok").getAsBoolean()
                        || !envelope.has("data") || !envelope.get("data").isJsonObject()) {
                    throw new IOException("Cape collection response was invalid.");
                }
                JsonObject data = envelope.getAsJsonObject("data");
                String selected = data.has("selectedCapeAssetId") && data.get("selectedCapeAssetId").isJsonPrimitive()
                        && data.get("selectedCapeAssetId").getAsJsonPrimitive().isString()
                        ? data.get("selectedCapeAssetId").getAsString() : null;
                JsonArray items = data.has("capes") && data.get("capes").isJsonArray()
                        ? data.getAsJsonArray("capes") : new JsonArray();
                List<CapeChoice> choices = new ArrayList<CapeChoice>();
                List<CosmeticTextureRegistry.OwnedCapeAsset> textures = new ArrayList<CosmeticTextureRegistry.OwnedCapeAsset>();
                long totalBytes = 0;
                for (JsonElement element : items) {
                    if (!element.isJsonObject() || choices.size() >= 24) continue;
                    JsonObject item = element.getAsJsonObject();
                    String assetId = stringValue(item, "assetId").toLowerCase(java.util.Locale.ROOT);
                    String sha = stringValue(item, "sha256").toLowerCase(java.util.Locale.ROOT);
                    String mime = stringValue(item, "contentType").toLowerCase(java.util.Locale.ROOT);
                    String name = stringValue(item, "name");
                    String source = stringValue(item, "source");
                    if (!assetId.matches("[a-f0-9]{64}") || !assetId.equals(sha)
                            || !("image/png".equals(mime) || "image/jpeg".equals(mime))
                            || name.length() > 80 || !("claimed".equals(source) || "assigned".equals(source))) continue;
                    byte[] image = fetchCosmeticAsset(sha, mime, "cape");
                    if (totalBytes + image.length > MAX_BATCH_ASSET_BYTES) continue;
                    totalBytes += image.length;
                    choices.add(new CapeChoice(assetId, name.isEmpty() ? "DewClient Cape" : name, source));
                    textures.add(new CosmeticTextureRegistry.OwnedCapeAsset(assetId, sha, image));
                }
                final List<CapeChoice> loadedChoices = Collections.unmodifiableList(choices);
                Minecraft.getInstance().execute(() -> {
                    capeChoices = loadedChoices;
                    String previousMicrosoftSelection = selectedCapeAssetId != null && selectedCapeAssetId.startsWith("ms:")
                            ? selectedCapeAssetId.substring(3) : null;
                    selectedCapeAssetId = selected != null ? selected
                            : previousMicrosoftSelection != null ? "ms:" + previousMicrosoftSelection
                            : activeMicrosoftCapeId == null ? null : "ms:" + activeMicrosoftCapeId;
                    int installed = CosmeticTextureRegistry.installOwnedCapes(textures, selected);
                    if (selected == null && previousMicrosoftSelection != null) {
                        CosmeticTextureRegistry.selectMicrosoftCape(previousMicrosoftSelection);
                    }
                    capeStatus = loadedChoices.isEmpty()
                            ? "No claimed or assigned DewClient capes yet."
                            : installed + " cape" + (installed == 1 ? "" : "s") + " ready. Select one to equip it.";
                    if (completion != null) completion.accept(true);
                });
            } catch (Exception ignored) {
                Minecraft.getInstance().execute(() -> {
                    capeStatus = "Could not load your cape collection. Reopen this page to retry.";
                    if (completion != null) completion.accept(false);
                });
            } finally {
                CAPE_REFRESH_IN_FLIGHT.set(false);
            }
        });
    }

    public static void selectCape(String assetId, Consumer<Boolean> completion) {
        if (assetId != null && assetId.startsWith("ms:")) {
            String microsoftCapeId = assetId.substring(3);
            if (accessToken == null || apiBaseUrl == null) {
                boolean selected = CosmeticTextureRegistry.selectMicrosoftCape(microsoftCapeId);
                if (selected) {
                    selectedCapeAssetId = assetId;
                    capeStatus = "Microsoft cape selected for this Minecraft profile.";
                }
                if (completion != null) completion.accept(selected);
                return;
            }
            selectCape(null, cleared -> {
                boolean selected = cleared && CosmeticTextureRegistry.selectMicrosoftCape(microsoftCapeId);
                if (selected) {
                    selectedCapeAssetId = assetId;
                    capeStatus = "Microsoft cape selected for this Minecraft profile.";
                    updateDesiredCape(microsoftCapeAssets.get(microsoftCapeId));
                }
                if (completion != null) completion.accept(selected);
            });
            return;
        }
        if (accessToken == null || apiBaseUrl == null) {
            if (completion != null) completion.accept(false);
            return;
        }
        NETWORK_EXECUTOR.execute(() -> {
            boolean success = false;
            HttpURLConnection connection = null;
            try {
                URI uri = URI.create(apiBaseUrl + "/client/cosmetics/equip-cape");
                connection = (HttpURLConnection) uri.toURL().openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(2500);
                connection.setReadTimeout(4000);
                connection.setInstanceFollowRedirects(false);
                connection.setDoOutput(true);
                connection.setRequestProperty("Authorization", "Bearer " + accessToken);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("Accept", "application/json");
                String value = assetId == null ? "null" : "\"" + assetId + "\"";
                byte[] body = ("{\"assetId\":" + value + "}").getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
                success = connection.getResponseCode() == HttpURLConnection.HTTP_OK;
            } catch (Exception ignored) {
                success = false;
            } finally {
                if (connection != null) connection.disconnect();
            }
            final boolean result = success;
            Minecraft.getInstance().execute(() -> {
                if (result) {
                    selectedCapeAssetId = assetId == null
                            ? (activeMicrosoftCapeId == null ? null : "ms:" + activeMicrosoftCapeId)
                            : assetId;
                    CosmeticTextureRegistry.selectOwnedCape(assetId);
                    if (assetId == null) {
                        updateDesiredCape(activeMicrosoftCapeId == null ? null : microsoftCapeAssets.get(activeMicrosoftCapeId));
                    }
                    capeStatus = assetId == null ? "Using the Minecraft profile's default cape." : "Cape selected. Other DewClient players will sync it shortly.";
                } else {
                    capeStatus = "Cape could not be selected. Refresh your collection and try again.";
                }
                if (completion != null) completion.accept(result);
            });
        });
    }

    private static void onClientTick(Minecraft client) {
        if (apiBaseUrl == null) return;
        long now = System.currentTimeMillis();
        if (accessToken != null && now >= nextOwnCapeRefreshAt) {
            nextOwnCapeRefreshAt = now + 15_000L;
            refreshOwnCapes();
        }
        if (client.level == null || client.player == null) {
            if (!observedPlayers.isEmpty()) {
                observedPlayers = "";
                pendingPlayerChange = false;
                CosmeticTextureRegistry.installPlayers(Collections.emptyList());
            }
            return;
        }
        if (accessToken != null && now >= nextOwnPublishAt
                && !ownAssetsSignature(desiredOwnAssets).equals(publishedOwnSignature)) {
            scheduleOwnCosmeticPublish();
        }

        List<net.minecraft.world.entity.player.Player> loadedPlayers = new ArrayList<net.minecraft.world.entity.player.Player>();
        for (net.minecraft.world.entity.player.Player player : client.level.players()) {
            if (player != null && !player.getUUID().equals(client.player.getUUID())) loadedPlayers.add(player);
        }
        loadedPlayers.sort(Comparator.comparingDouble(player -> player.distanceToSqr(client.player)));
        List<UUID> visiblePlayers = new ArrayList<UUID>();
        for (net.minecraft.world.entity.player.Player player : loadedPlayers) visiblePlayers.add(player.getUUID());
        visiblePlayers.sort(Comparator.comparing(UUID::toString));

        StringBuilder signature = new StringBuilder();
        for (UUID uuid : visiblePlayers) signature.append(uuid).append(',');
        String currentSignature = signature.toString();
        if (!currentSignature.equals(observedPlayers)) {
            observedPlayers = currentSignature;
            pendingPlayerChange = true;
        }

        if (visiblePlayers.isEmpty()) {
            if (pendingPlayerChange && !REQUEST_IN_FLIGHT.get()) {
                CosmeticTextureRegistry.installPlayers(Collections.emptyList());
                pendingPlayerChange = false;
            }
            return;
        }

        boolean changedAndDebounced = pendingPlayerChange && now - lastRequestAt >= 5_000L;
        if (REQUEST_IN_FLIGHT.get() || now < retryNotBefore
                || (!changedAndDebounced && now < nextPeriodicRefreshAt)) return;

        pendingPlayerChange = false;
        lastRequestAt = now;
        nextPeriodicRefreshAt = now + REFRESH_INTERVAL_MS + (long) (Math.random() * 8_000L);
        fetchVisiblePlayers(new ArrayList<UUID>(visiblePlayers));
    }

    private static void fetchVisiblePlayers(List<UUID> playerUuids) {
        if (!REQUEST_IN_FLIGHT.compareAndSet(false, true)) return;
        NETWORK_EXECUTOR.execute(() -> {
            try {
                List<CosmeticTextureRegistry.PlayerCosmetics> players = loadVisiblePlayerCosmetics(playerUuids);
                retryNotBefore = 0;
                Minecraft.getInstance().execute(() -> {
                    int installed = CosmeticTextureRegistry.installPlayers(players);
                    if (installed > 0) {
                        System.out.println("[DewCosmetics] Refreshed textures for " + players.size() + " nearby player(s).");
                    }
                });
            } catch (Exception error) {
                retryNotBefore = System.currentTimeMillis() + 30_000L;
                nextPeriodicRefreshAt = retryNotBefore;
                System.err.println("[DewCosmetics] Other players' cosmetics could not be refreshed; retrying later.");
            } finally {
                REQUEST_IN_FLIGHT.set(false);
            }
        });
    }

    private static List<CosmeticTextureRegistry.PlayerCosmetics> loadVisiblePlayerCosmetics(List<UUID> requestedPlayers) throws IOException {
        List<CosmeticTextureRegistry.PlayerCosmetics> all = new ArrayList<CosmeticTextureRegistry.PlayerCosmetics>();
        for (int start = 0; start < requestedPlayers.size(); start += MAX_PLAYERS_PER_REQUEST) {
            int end = Math.min(requestedPlayers.size(), start + MAX_PLAYERS_PER_REQUEST);
            all.addAll(loadPlayerCosmeticsBatch(new ArrayList<UUID>(requestedPlayers.subList(start, end))));
        }
        return all;
    }

    private static List<CosmeticTextureRegistry.PlayerCosmetics> loadPlayerCosmeticsBatch(List<UUID> requestedPlayers) throws IOException {
        if (requestedPlayers.isEmpty()) return Collections.emptyList();
        StringBuilder ids = new StringBuilder();
        Set<UUID> requestedSet = new HashSet<UUID>(requestedPlayers);
        for (UUID uuid : requestedPlayers) {
            if (ids.length() > 0) ids.append(',');
            ids.append(uuid.toString());
        }

        String encodedIds = URLEncoder.encode(ids.toString(), StandardCharsets.UTF_8);
        byte[] response = fetchBytes(apiBaseUrl + "/cosmetics/players?uuids=" + encodedIds,
                "application/json", MAX_JSON_BYTES, null, null);
        JsonObject envelope;
        try {
            envelope = new JsonParser().parse(new String(response, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (RuntimeException error) {
            throw new IOException("Cosmetics player response is invalid.", error);
        }
        if (!envelope.has("ok") || !envelope.get("ok").getAsBoolean()
                || !envelope.has("data") || !envelope.get("data").isJsonArray()) {
            throw new IOException("Cosmetics player response was unsuccessful.");
        }

        List<CosmeticReference> references = new ArrayList<CosmeticReference>();
        JsonArray entries = envelope.getAsJsonArray("data");
        for (JsonElement element : entries) {
            if (!element.isJsonObject()) continue;
            JsonObject player = element.getAsJsonObject();
            UUID uuid;
            try {
                uuid = UUID.fromString(stringValue(player, "playerUuid"));
            } catch (RuntimeException ignored) {
                continue;
            }
            if (!requestedSet.contains(uuid)) continue;
            addReference(references, uuid, "skin", player.get("skin"));
            addReference(references, uuid, "cape", player.get("cape"));
            addReference(references, uuid, "wings", player.get("elytra"));
        }

        List<CosmeticTextureRegistry.PlayerCosmetics> loaded = new ArrayList<CosmeticTextureRegistry.PlayerCosmetics>();
        Map<UUID, List<CosmeticTextureRegistry.DownloadedAsset>> grouped = new LinkedHashMap<UUID, List<CosmeticTextureRegistry.DownloadedAsset>>();
        Set<String> retainedHashes = new HashSet<String>();
        long retainedBytes = 0;
        for (CosmeticReference reference : references) {
            try {
                byte[] bytes = fetchCosmeticAsset(reference.sha256, reference.mime, reference.type);
                if (!retainedHashes.contains(reference.sha256)) {
                    if (retainedBytes + bytes.length > MAX_BATCH_ASSET_BYTES) continue;
                    retainedHashes.add(reference.sha256);
                    retainedBytes += bytes.length;
                }
                grouped.computeIfAbsent(reference.playerUuid, ignored -> new ArrayList<CosmeticTextureRegistry.DownloadedAsset>())
                        .add(new CosmeticTextureRegistry.DownloadedAsset(reference.type, reference.sha256, bytes));
            } catch (IOException ignored) {
                // A single corrupt or unavailable texture must not block other players' cosmetics.
            }
        }
        for (Map.Entry<UUID, List<CosmeticTextureRegistry.DownloadedAsset>> entry : grouped.entrySet()) {
            loaded.add(new CosmeticTextureRegistry.PlayerCosmetics(entry.getKey(), entry.getValue()));
        }
        return loaded;
    }

    private static void addReference(List<CosmeticReference> output, UUID uuid, String type, JsonElement value) {
        if (value == null || !value.isJsonObject()) return;
        JsonObject asset = value.getAsJsonObject();
        if (!asset.has("enabled") || !asset.get("enabled").isJsonPrimitive()
                || !asset.get("enabled").getAsJsonPrimitive().isBoolean()
                || !asset.get("enabled").getAsBoolean()) return;
        String assetId = stringValue(asset, "assetId").toLowerCase(java.util.Locale.ROOT);
        String sha256 = stringValue(asset, "sha256").toLowerCase(java.util.Locale.ROOT);
        String mime = stringValue(asset, "contentType").toLowerCase(java.util.Locale.ROOT);
        if (!assetId.matches("[a-f0-9]{64}") || !assetId.equals(sha256)
                || !sha256.matches("[a-f0-9]{64}")
                || !("image/png".equals(mime) || "image/jpeg".equals(mime))) return;
        if (asset.has("byteSize")) {
            if (!asset.get("byteSize").isJsonPrimitive() || !asset.get("byteSize").getAsJsonPrimitive().isNumber()) return;
            long declaredBytes;
            try { declaredBytes = asset.get("byteSize").getAsLong(); } catch (RuntimeException ignored) { return; }
            if (declaredBytes <= 0 || declaredBytes > MAX_ASSET_BYTES) return;
        }
        output.add(new CosmeticReference(uuid, type, sha256, mime));
    }

    private static byte[] fetchCosmeticAsset(String sha256, String mime, String type) throws IOException {
        synchronized (ASSET_CACHE) {
            byte[] cached = ASSET_CACHE.get(sha256);
            if (cached != null) return cached;
        }
        byte[] bytes = fetchBytes(apiBaseUrl + "/cosmetics/assets/" + sha256, mime, MAX_ASSET_BYTES, mime, null);
        if (!sha256.equals(sha256(bytes))) throw new IOException("Cosmetics asset checksum mismatch.");
        if ("image/jpeg".equals(mime)) bytes = convertJpegToPng(bytes, type);
        synchronized (ASSET_CACHE) {
            byte[] previous = ASSET_CACHE.put(sha256, bytes);
            if (previous != null) cachedAssetBytes -= previous.length;
            cachedAssetBytes += bytes.length;
            Iterator<Map.Entry<String, byte[]>> iterator = ASSET_CACHE.entrySet().iterator();
            while ((ASSET_CACHE.size() > 48 || cachedAssetBytes > MAX_CACHED_ASSET_BYTES) && iterator.hasNext()) {
                Map.Entry<String, byte[]> eldest = iterator.next();
                cachedAssetBytes -= eldest.getValue().length;
                iterator.remove();
            }
        }
        return bytes;
    }

    private static byte[] convertJpegToPng(byte[] jpeg, String type) throws IOException {
        try (ImageInputStream imageInput = ImageIO.createImageInputStream(new ByteArrayInputStream(jpeg))) {
            if (imageInput == null) throw new IOException("JPEG texture could not be opened.");
            java.util.Iterator<ImageReader> readers = ImageIO.getImageReaders(imageInput);
            if (!readers.hasNext()) throw new IOException("JPEG texture format is unsupported.");
            ImageReader reader = readers.next();
            try {
                reader.setInput(imageInput, true, true);
                if (!validDimensions(type, reader.getWidth(0), reader.getHeight(0))) {
                    throw new IOException("JPEG texture dimensions are invalid.");
                }
                BufferedImage image = reader.read(0);
                if (image == null) throw new IOException("JPEG texture could not be decoded.");
                try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (!ImageIO.write(image, "png", output)) throw new IOException("JPEG texture could not be converted to PNG.");
                    return output.toByteArray();
                } finally {
                    image.flush();
                }
            } finally {
                reader.dispose();
            }
        }
    }

    private static boolean validDimensions(String type, int width, int height) {
        if (!(width == 64 || width == 128 || width == 256 || width == 512 || width == 1024 || width == 2048)
                || height < 32 || height > 1024) return false;
        if ("skin".equals(type)) return height == width || height == width / 2;
        return ("cape".equals(type) || "wings".equals(type)) && height == width / 2;
    }

    private static byte[] fetchBytes(String url, String accept, int maxBytes, String expectedContentType, String bearerToken) throws IOException {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException error) {
            throw new IOException("Cosmetics API URL is invalid.", error);
        }
        URI base = URI.create(apiBaseUrl);
        String requestPath = uri.getPath() == null ? "" : uri.getPath();
        boolean playersLookup = requestPath.endsWith("/cosmetics/players");
        boolean ownCollection = requestPath.endsWith("/client/cosmetics/me");
        boolean assetLookup = requestPath.matches(".*/cosmetics/assets/[a-f0-9]{64}");
        boolean invalidQuery = playersLookup
                ? uri.getQuery() == null || !uri.getQuery().startsWith("uuids=")
                : uri.getQuery() != null;
        if (!"https".equals(uri.getScheme()) || !base.getHost().equalsIgnoreCase(uri.getHost())
                || uri.getPort() != base.getPort() || uri.getUserInfo() != null || uri.getFragment() != null
                || invalidQuery
                || !(playersLookup || ownCollection || assetLookup)
                || !requestPath.startsWith(base.getPath() + "/")) {
            throw new IOException("Cosmetics API URL is outside the configured HTTPS service.");
        }
        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(2500);
        connection.setReadTimeout(4000);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(true);
        connection.setRequestProperty("Accept", accept);
        if (bearerToken != null && !bearerToken.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + bearerToken);
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IOException("Cosmetics API returned HTTP " + status + ".");
            String contentType = connection.getContentType();
            boolean contentTypeMatches = expectedContentType == null
                    ? contentType != null && contentType.toLowerCase(java.util.Locale.ROOT).startsWith("application/json")
                    : contentType != null && expectedContentType.equalsIgnoreCase(contentType.split(";", 2)[0].trim());
            if (!contentTypeMatches) {
                throw new IOException("Cosmetics API returned an unexpected content type.");
            }
            long declaredLength = connection.getContentLengthLong();
            if (declaredLength > maxBytes) throw new IOException("Cosmetics API response exceeds the size limit.");
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int total = 0;
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > maxBytes) throw new IOException("Cosmetics API response exceeds the size limit.");
                    output.write(buffer, 0, read);
                }
                return output.toByteArray();
            }
        } finally {
            connection.disconnect();
        }
    }

    private static String validateBaseUrl(String value) {
        try {
            URI uri = URI.create(value.trim());
            String path = uri.getPath() == null ? "" : uri.getPath().replaceAll("/+$", "");
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getQuery() != null || uri.getFragment() != null || !path.endsWith("/api/v1")) return null;
            return uri.toString().replaceAll("/+$", "");
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    private static String stringValue(JsonObject object, String key) {
        JsonElement value = object.get(key);
        return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()
                ? value.getAsString() : "";
    }

    private static String sha256(byte[] bytes) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
            return result.toString();
        } catch (Exception error) {
            throw new IOException("Unable to verify a cosmetics texture.", error);
        }
    }

    private static final class CosmeticReference {
        private final UUID playerUuid;
        private final String type;
        private final String sha256;
        private final String mime;

        private CosmeticReference(UUID playerUuid, String type, String sha256, String mime) {
            this.playerUuid = playerUuid;
            this.type = type;
            this.sha256 = sha256;
            this.mime = mime;
        }
    }
}
