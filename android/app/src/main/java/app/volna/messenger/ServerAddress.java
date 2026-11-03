package app.volna.messenger;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Keeps the WebView and cleartext HTTP inside the explicitly selected server. */
public final class ServerAddress {
    private ServerAddress() {}

    public static String normalize(String raw) {
        try {
            URI uri = new URI(raw.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if ((!scheme.equals("http") && !scheme.equals("https")) || host.isEmpty()
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (!uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))
                    || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IllegalArgumentException("Укажите полный адрес сервера без пути, например http://192.168.0.19:8787");
            }
            if (scheme.equals("http") && !isLocal(host)) {
                throw new IllegalArgumentException("Для сервера в интернете нужен HTTPS. HTTP доступен только в локальной сети.");
            }
            return new URI(scheme, null, host, uri.getPort(), null, null, null).toASCIIString();
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Проверьте адрес сервера: http://адрес-ПК:8787");
        }
    }

    private static boolean isLocal(String host) {
        if (host.equals("localhost") || host.equals("127.0.0.1") || host.endsWith(".local")) return true;
        String[] parts = host.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] ip = new int[4];
        try {
            for (int i = 0; i < 4; i++) {
                if (!parts[i].matches("[0-9]{1,3}")) return false;
                ip[i] = Integer.parseInt(parts[i]);
                if (ip[i] > 255) return false;
            }
        } catch (NumberFormatException error) { return false; }
        return ip[0] == 10 || (ip[0] == 192 && ip[1] == 168)
                || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31);
    }

    public static boolean sameOrigin(String origin, String candidate) {
        try {
            URI a = new URI(origin), b = new URI(candidate);
            return b.getRawUserInfo() == null && a.getScheme().equalsIgnoreCase(b.getScheme())
                    && a.getHost().equalsIgnoreCase(b.getHost()) && port(a) == port(b);
        } catch (Exception error) { return false; }
    }

    private static int port(URI uri) {
        return uri.getPort() == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : uri.getPort();
    }
}
