package fun.dewclient.cosmetics.bridge;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

public final class BridgeClient {
    private static final int CONNECT_TIMEOUT_MILLIS = 1500;
    private static final int READ_TIMEOUT_MILLIS = 2500;
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;
    private static final int MAX_ASSET_BYTES = 50 * 1024 * 1024;

    private BridgeClient() {
    }

    public static BridgeConfig fetchLaunchConfig() throws IOException {
        String bridgeUrl = System.getenv("DEWCLIENT_BRIDGE_URL");
        String bridgeToken = System.getenv("DEWCLIENT_BRIDGE_TOKEN");
        String instanceId = System.getenv("DEWCLIENT_INSTANCE_ID");
        if (isBlank(bridgeUrl) && isBlank(bridgeToken) && isBlank(instanceId)) {
            return null;
        }
        if (isBlank(bridgeUrl) || isBlank(bridgeToken) || isBlank(instanceId)) {
            throw new IOException("DewCosmetics bridge launch configuration is incomplete.");
        }

        URI baseUri;
        try {
            baseUri = URI.create(bridgeUrl);
        } catch (IllegalArgumentException error) {
            throw new IOException("DewCosmetics bridge URL is invalid.", error);
        }
        if (!"http".equals(baseUri.getScheme()) || !"127.0.0.1".equals(baseUri.getHost())
                || baseUri.getPort() < 1 || baseUri.getPort() > 65535
                || (baseUri.getPath() != null && !baseUri.getPath().isEmpty())
                || baseUri.getUserInfo() != null || baseUri.getQuery() != null || baseUri.getFragment() != null) {
            throw new IOException("DewCosmetics bridge must use the configured IPv4 loopback endpoint.");
        }

        URL configUrl = new URL(baseUri.toString() + "/v1/mod/config");
        HttpURLConnection connection = (HttpURLConnection) configUrl.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
        connection.setReadTimeout(READ_TIMEOUT_MILLIS);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + bridgeToken);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("DewCosmetics bridge config request failed.");
            }
            String contentType = connection.getContentType();
            if (contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT).startsWith("application/json")) {
                throw new IOException("DewCosmetics bridge returned an unexpected content type.");
            }
            String response = readBounded(connection.getInputStream());
            try {
                return BridgeConfig.parse(response, instanceId);
            } catch (RuntimeException error) {
                throw new IOException("DewCosmetics bridge config failed validation.", error);
            }
        } finally {
            connection.disconnect();
        }
    }

    public static byte[] fetchAsset(BridgeConfig.CosmeticAsset asset) throws IOException {
        return fetchAsset(asset.getUrl(), asset.getSha256(), asset.getMime());
    }

    public static byte[] fetchAsset(BridgeConfig.MicrosoftCape asset) throws IOException {
        return fetchAsset(asset.getUrl(), asset.getSha256(), asset.getMime());
    }

    private static byte[] fetchAsset(String assetUrl, String expectedSha256, String expectedMime) throws IOException {
        String bridgeToken = System.getenv("DEWCLIENT_BRIDGE_TOKEN");
        if (isBlank(bridgeToken)) {
            throw new IOException("DewCosmetics bridge authentication is unavailable.");
        }

        URL assetUrlValue = URI.create(assetUrl).toURL();
        HttpURLConnection connection = (HttpURLConnection) assetUrlValue.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
        connection.setReadTimeout(READ_TIMEOUT_MILLIS);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", expectedMime);
        connection.setRequestProperty("Authorization", "Bearer " + bridgeToken);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("DewCosmetics asset request failed.");
            }
            String contentType = connection.getContentType();
            if (contentType == null || !expectedMime.equalsIgnoreCase(contentType.split(";", 2)[0].trim())) {
                throw new IOException("DewCosmetics asset content type does not match its metadata.");
            }
            if (connection.getContentLengthLong() > MAX_ASSET_BYTES) {
                throw new IOException("DewCosmetics asset exceeds the size limit.");
            }

            byte[] bytes = readBoundedBytes(connection.getInputStream(), MAX_ASSET_BYTES);
            if (!expectedSha256.equals(sha256(bytes))) {
                throw new IOException("DewCosmetics asset hash does not match its metadata.");
            }
            return bytes;
        } finally {
            connection.disconnect();
        }
    }

    private static String readBounded(InputStream input) throws IOException {
        return new String(readBoundedBytes(input, MAX_RESPONSE_BYTES), StandardCharsets.UTF_8);
    }

    private static byte[] readBoundedBytes(InputStream input, int maximumBytes) throws IOException {
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > maximumBytes) {
                    throw new IOException("DewCosmetics bridge response exceeds the size limit.");
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        } finally {
            input.close();
        }
    }

    private static String sha256(byte[] bytes) throws IOException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("SHA-256 is unavailable.", error);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
