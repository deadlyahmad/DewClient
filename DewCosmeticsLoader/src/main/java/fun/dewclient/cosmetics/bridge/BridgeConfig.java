package fun.dewclient.cosmetics.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

public final class BridgeConfig {
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;
    private static final Pattern COSMETIC_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");

    private final String instanceId;
    private final String minecraftVersion;
    private final String modVersion;
    private final int protocolVersion;
    private final long revision;
    private final List<String> equippedCosmeticIds;
    private final List<CosmeticAsset> assets;
    private final List<MicrosoftCape> microsoftCapes;
    private final String apiBaseUrl;
    private final String apiAccessToken;

    public static final class CosmeticAsset {
        private final String cosmeticId;
        private final String type;
        private final String url;
        private final String sha256;
        private final String mime;

        private CosmeticAsset(String cosmeticId, String type, String url, String sha256, String mime) {
            this.cosmeticId = cosmeticId;
            this.type = type;
            this.url = url;
            this.sha256 = sha256;
            this.mime = mime;
        }

        public String getCosmeticId() {
            return cosmeticId;
        }

        public String getType() {
            return type;
        }

        public String getUrl() {
            return url;
        }

        public String getSha256() {
            return sha256;
        }

        public String getMime() {
            return mime;
        }
    }

    private BridgeConfig(String instanceId, String minecraftVersion, String modVersion,
                         int protocolVersion, long revision, List<String> equippedCosmeticIds,
                         List<CosmeticAsset> assets, List<MicrosoftCape> microsoftCapes,
                         String apiBaseUrl, String apiAccessToken) {
        this.instanceId = instanceId;
        this.minecraftVersion = minecraftVersion;
        this.modVersion = modVersion;
        this.protocolVersion = protocolVersion;
        this.revision = revision;
        this.equippedCosmeticIds = equippedCosmeticIds;
        this.assets = assets;
        this.microsoftCapes = microsoftCapes;
        this.apiBaseUrl = apiBaseUrl;
        this.apiAccessToken = apiAccessToken;
    }

    public static BridgeConfig parse(String json, String expectedInstanceId) {
        JsonObject envelope = new JsonParser().parse(json).getAsJsonObject();
        if (!envelope.has("ok") || !envelope.get("ok").getAsBoolean() || !envelope.has("data")) {
            throw new IllegalArgumentException("Bridge returned an unsuccessful config response.");
        }

        JsonObject data = envelope.getAsJsonObject("data");
        String instanceId = requiredString(data, "instanceId");
        if (!instanceId.equals(expectedInstanceId)) {
            throw new IllegalArgumentException("Bridge instance does not match the launched instance.");
        }

        String minecraftVersion = requiredString(data, "minecraftVersion");
        String modVersion = requiredString(data, "modVersion");
        long protocolVersion = requiredSafeInteger(data, "protocolVersion", 1, MAX_SAFE_INTEGER);
        if (protocolVersion != 1) {
            throw new IllegalArgumentException("DewCosmetics protocol mismatch.");
        }

        JsonObject equipped = requiredObject(data, "equipped");
        long revision = requiredSafeInteger(equipped, "revision", 0, MAX_SAFE_INTEGER);
        JsonArray items = requiredArray(equipped, "items");
        if (items.size() > 64) {
            throw new IllegalArgumentException("Bridge equipped snapshot exceeds the item limit.");
        }

        Set<String> seen = new HashSet<String>();
        List<String> enabledIds = new ArrayList<String>();
        for (JsonElement element : items) {
            if (!element.isJsonObject()) {
                throw new IllegalArgumentException("Bridge equipped item is invalid.");
            }
            JsonObject item = element.getAsJsonObject();
            String cosmeticId = requiredString(item, "cosmeticId");
            if (!COSMETIC_ID.matcher(cosmeticId).matches() || !seen.add(cosmeticId)) {
                throw new IllegalArgumentException("Bridge equipped item ID is invalid or duplicated.");
            }
            requiredSafeInteger(item, "assetVersion", 1, MAX_SAFE_INTEGER);
            JsonElement enabled = item.get("enabled");
            if (enabled == null || !enabled.isJsonPrimitive() || !enabled.getAsJsonPrimitive().isBoolean()) {
                throw new IllegalArgumentException("Bridge equipped item enabled flag is invalid.");
            }
            if (enabled.getAsBoolean()) {
                enabledIds.add(cosmeticId);
            }
        }

        List<CosmeticAsset> assets = new ArrayList<CosmeticAsset>();
        JsonArray definitions = data.has("definitions") && data.get("definitions").isJsonArray()
                ? data.getAsJsonArray("definitions") : new JsonArray();
        if (definitions.size() > 64) {
            throw new IllegalArgumentException("Bridge cosmetic definitions exceed the item limit.");
        }
        for (JsonElement element : definitions) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject definition = element.getAsJsonObject();
            JsonElement definitionIdValue = definition.get("id");
            JsonElement typeValue = definition.get("type");
            if (definitionIdValue == null || !definitionIdValue.isJsonPrimitive()
                    || !definitionIdValue.getAsJsonPrimitive().isString()
                    || typeValue == null || !typeValue.isJsonPrimitive()
                    || !typeValue.getAsJsonPrimitive().isString()) {
                continue;
            }
            String cosmeticId = definitionIdValue.getAsString();
            String type = typeValue.getAsString();
            if (!enabledIds.contains(cosmeticId) || !COSMETIC_ID.matcher(cosmeticId).matches()
                    || !("skin".equals(type) || "cape".equals(type) || "wings".equals(type))) {
                continue;
            }
            try {
                JsonObject texture = requiredObject(requiredObject(definition, "assets"), "texture");
                String url = requiredString(texture, "url");
                String sha256 = requiredString(texture, "sha256").toLowerCase(java.util.Locale.ROOT);
                String mime = requiredString(texture, "mime").toLowerCase(java.util.Locale.ROOT);
                URI assetUri = URI.create(url);
                if (!sha256.matches("[a-f0-9]{64}")
                        || !("image/png".equals(mime) || "image/jpeg".equals(mime) || "image/webp".equals(mime))
                        || !"http".equals(assetUri.getScheme()) || !"127.0.0.1".equals(assetUri.getHost())
                        || assetUri.getPort() < 1 || assetUri.getUserInfo() != null
                        || assetUri.getQuery() != null || assetUri.getFragment() != null
                        || !assetUri.getPath().endsWith("/v1/mod/assets/" + sha256)) {
                    continue;
                }
                assets.add(new CosmeticAsset(cosmeticId, type, url, sha256, mime));
            } catch (RuntimeException ignored) {
                // Ignore one malformed cosmetic definition without discarding the whole snapshot.
            }
        }

        List<MicrosoftCape> microsoftCapes = new ArrayList<MicrosoftCape>();
        JsonArray capeData = data.has("microsoftCapes") && data.get("microsoftCapes").isJsonArray()
                ? data.getAsJsonArray("microsoftCapes") : new JsonArray();
        if (capeData.size() > 24) throw new IllegalArgumentException("Microsoft cape catalog exceeds the item limit.");
        for (JsonElement element : capeData) {
            if (!element.isJsonObject()) continue;
            JsonObject cape = element.getAsJsonObject();
            try {
                String id = requiredString(cape, "id").toLowerCase(java.util.Locale.ROOT);
                String name = requiredString(cape, "name");
                String url = requiredString(cape, "url");
                String sha256 = requiredString(cape, "sha256").toLowerCase(java.util.Locale.ROOT);
                String mime = requiredString(cape, "mime").toLowerCase(java.util.Locale.ROOT);
                JsonElement active = cape.get("active");
                URI assetUri = URI.create(url);
                if (!id.matches("[a-f0-9]{64}") || !id.equals(sha256) || name.length() > 80
                        || !("image/png".equals(mime) || "image/jpeg".equals(mime))
                        || active == null || !active.isJsonPrimitive() || !active.getAsJsonPrimitive().isBoolean()
                        || !"http".equals(assetUri.getScheme()) || !"127.0.0.1".equals(assetUri.getHost())
                        || assetUri.getPort() < 1 || assetUri.getUserInfo() != null || assetUri.getQuery() != null
                        || assetUri.getFragment() != null || !assetUri.getPath().endsWith("/v1/mod/assets/" + sha256)) continue;
                microsoftCapes.add(new MicrosoftCape(id, name, url, sha256, mime, active.getAsBoolean()));
            } catch (RuntimeException ignored) {
                // Ignore one invalid local cape without dropping the full launch config.
            }
        }

        String apiBaseUrl = parseOfficialApiBaseUrl(data.get("apiBaseUrl"));
        String apiAccessToken = null;
        JsonElement sessionValue = data.get("session");
        if (sessionValue != null && sessionValue.isJsonObject()) {
            JsonObject session = sessionValue.getAsJsonObject();
            if (apiBaseUrl == null) apiBaseUrl = parseOfficialApiBaseUrl(session.get("apiBaseUrl"));
            JsonElement accessTokenValue = session.get("accessToken");
            if (accessTokenValue != null && accessTokenValue.isJsonPrimitive()
                    && accessTokenValue.getAsJsonPrimitive().isString()) {
                String candidate = accessTokenValue.getAsString().trim();
                if (candidate.length() >= 32 && candidate.length() <= 4096
                        && candidate.matches("[A-Za-z0-9_.-]+")) apiAccessToken = candidate;
            }
        }

        return new BridgeConfig(instanceId, minecraftVersion, modVersion, (int) protocolVersion,
                revision, enabledIds, assets, microsoftCapes, apiBaseUrl, apiAccessToken);
    }

    private static String parseOfficialApiBaseUrl(JsonElement value) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) return null;
        String candidate = value.getAsString().trim();
        try {
            URI apiUri = URI.create(candidate);
            if (candidate.length() <= 256 && "https".equals(apiUri.getScheme())
                    && "server.dewclient.fun".equalsIgnoreCase(apiUri.getHost())
                    && (apiUri.getPort() == -1 || apiUri.getPort() == 443)
                    && "/api/v1".equals(apiUri.getPath())
                    && apiUri.getUserInfo() == null && apiUri.getQuery() == null
                    && apiUri.getFragment() == null) {
                return "https://server.dewclient.fun/api/v1";
            }
        } catch (IllegalArgumentException ignored) {
            // Local cosmetics still load when the optional public API URL is invalid.
        }
        return null;
    }

    public String getInstanceId() {
        return instanceId;
    }

    public String getMinecraftVersion() {
        return minecraftVersion;
    }

    public String getModVersion() {
        return modVersion;
    }

    public int getProtocolVersion() {
        return protocolVersion;
    }

    public long getRevision() {
        return revision;
    }

    public List<String> getEquippedCosmeticIds() {
        return new ArrayList<String>(equippedCosmeticIds);
    }

    public List<CosmeticAsset> getAssets() {
        return new ArrayList<CosmeticAsset>(assets);
    }

    public List<MicrosoftCape> getMicrosoftCapes() { return new ArrayList<MicrosoftCape>(microsoftCapes); }

    public String getApiBaseUrl() {
        return apiBaseUrl;
    }

    public static final class MicrosoftCape {
        private final String id;
        private final String name;
        private final String url;
        private final String sha256;
        private final String mime;
        private final boolean active;

        private MicrosoftCape(String id, String name, String url, String sha256, String mime, boolean active) {
            this.id = id;
            this.name = name;
            this.url = url;
            this.sha256 = sha256;
            this.mime = mime;
            this.active = active;
        }
        public String getId() { return id; }
        public String getName() { return name; }
        public String getUrl() { return url; }
        public String getSha256() { return sha256; }
        public String getMime() { return mime; }
        public boolean isActive() { return active; }
    }

    public String getApiAccessToken() {
        return apiAccessToken;
    }

    private static String requiredString(JsonObject object, String key) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new IllegalArgumentException("Bridge config field is invalid: " + key);
        }
        String text = value.getAsString();
        if (text.length() == 0 || text.length() > 256) {
            throw new IllegalArgumentException("Bridge config field is invalid: " + key);
        }
        return text;
    }

    private static long requiredSafeInteger(JsonObject object, String key, long minimum, long maximum) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("Bridge config number is invalid: " + key);
        }
        String text = value.getAsString();
        if (!text.matches("0|[1-9][0-9]*")) {
            throw new IllegalArgumentException("Bridge config number is invalid: " + key);
        }
        try {
            long number = Long.parseLong(text);
            if (number < minimum || number > maximum) {
                throw new IllegalArgumentException("Bridge config number is out of range: " + key);
            }
            return number;
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Bridge config number is out of range: " + key, error);
        }
    }

    private static JsonObject requiredObject(JsonObject object, String key) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonObject()) {
            throw new IllegalArgumentException("Bridge config object is invalid: " + key);
        }
        return value.getAsJsonObject();
    }

    private static JsonArray requiredArray(JsonObject object, String key) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonArray()) {
            throw new IllegalArgumentException("Bridge config array is invalid: " + key);
        }
        return value.getAsJsonArray();
    }
}
