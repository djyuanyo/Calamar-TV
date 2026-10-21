package es.yuanyo.calamartv;

import java.net.URI;
import java.util.Locale;

/** URLs the Default Media Receiver can load without app-only request headers. */
public final class CastSource {
  private CastSource() {}

  public static String contentType(String address) {
    try {
      URI u = URI.create(address);
      if (!("http".equalsIgnoreCase(u.getScheme()) || "https".equalsIgnoreCase(u.getScheme()))
          || u.getHost() == null || u.getUserInfo() != null) return null;
      String path = u.getPath().toLowerCase(Locale.ROOT);
      if (path.endsWith(".m3u8")) return "application/x-mpegURL";
      if (path.endsWith(".mpd")) return "application/dash+xml";
      if (path.endsWith(".mp4")) return "video/mp4";
      if (path.endsWith(".webm")) return "video/webm";
    } catch (Exception invalid) { /* No URL or secret is written to logs. */ }
    return null;
  }

  public static boolean live(String type) {
    return "application/x-mpegURL".equals(type) || "application/dash+xml".equals(type);
  }

  public static boolean needsBridge(String address) {
    try {
      URI u = URI.create(address);
      String host = u.getHost();
      if (!"http".equalsIgnoreCase(u.getScheme()) || host == null || u.getUserInfo() != null
          || u.getPort() == 0 || u.getPort() > 65535 || u.getRawFragment() != null || !host.matches("[a-zA-Z0-9.-]+")) return false;
      host = host.toLowerCase(Locale.ROOT);
      if (host.equals("localhost") || host.matches(".*\\.(localhost|local|internal)")) return false;
      if (host.matches("[0-9]+(?:\\.[0-9]+){3}")) {
        String[] parts = host.split("\\.");
        int a = Integer.parseInt(parts[0]), b = Integer.parseInt(parts[1]);
        if (a == 0 || a == 10 || a == 127 || a >= 224 || (a == 169 && b == 254)
            || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168)
            || (a == 100 && b >= 64 && b <= 127)) return false;
      }
      String path = u.getRawPath().toLowerCase(Locale.ROOT);
      return path.endsWith(".ts") || path.matches("/(?:live/)?[^/]+/[^/]+/[0-9]+(?:\\.ts)?");
    } catch (Exception invalid) { return false; }
  }
}