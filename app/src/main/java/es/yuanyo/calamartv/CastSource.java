package es.yuanyo.calamartv;

import java.net.URI;
import java.util.Locale;

/** URLs the Default Media Receiver can load without app-only request headers. */
public final class CastSource {
  private CastSource() {}

  public static String contentType(String address) {
    if (onDemand(address)) return "application/x-mpegURL";
    // A list already relayed by the hosting (calamar-player.php, signed): it answers any origin.
    if (address != null && HostingPlayback.isRelay(address) && address.contains("seg=") && address.contains("sig=")) return "application/x-mpegURL";
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

  /** Convert only the signed links issued by the Calamar Drive bridge. */
  public static String driveCompatibility(String address) {
    try {
      URI u = URI.create(address);
      if (!"https".equalsIgnoreCase(u.getScheme()) || !"calamarmenciano.com".equalsIgnoreCase(u.getHost())
          || u.getUserInfo() != null || u.getPort() != -1 || !"/calamar-drive.php".equals(u.getPath())
          || u.getRawQuery() == null) return null;
      String id = null, token = null;
      for (String parameter : u.getRawQuery().split("&")) {
        if (parameter.matches("id=[A-Za-z0-9_-]{1,200}")) id = parameter;
        if (parameter.matches("v=[A-Za-z0-9_-]{40,2048}")) token = parameter;
      }
      return id == null || token == null ? null : "https://calamarmenciano.com/calamar-drive.php?" + id + "&" + token + "&hls=1";
    } catch (IllegalArgumentException | NullPointerException invalid) { return null; }
  }

  static boolean isDriveCompatibility(String address) {
    return address != null && address.equals(driveCompatibility(address));
  }

  /** A provider film through the hosting: an HLS list the TV can read, not live. */
  public static boolean onDemand(String address) {
    return isDriveCompatibility(address) || ProviderPlayers.isVidaraStream(address)
        || (address != null && address.startsWith(Library.LULU_ENDPOINT + "?code=") && address.contains("&hls=1"));
  }

  public static boolean live(String type) {
    return "application/x-mpegURL".equals(type) || "application/dash+xml".equals(type);
  }

  /** M3U8 addresses: an HTTP one cannot load on the receiver's HTTPS page, so the hosting relays it. */
  public static boolean list(String address) {
    try {
      String path = URI.create(address).getPath();
      return path != null && path.toLowerCase(Locale.ROOT).endsWith(".m3u8");
    } catch (Exception invalid) { return false; }
  }

  /** MPEG-TS the hosting converts for the TV (calamar-cast.php): HTTP IPTV and also .ts over HTTPS. */
  public static boolean castBridge(String address) {
    if (needsBridge(address)) return true;
    return address != null && address.regionMatches(true, 0, "https://", 0, 8)
        && needsBridge("http://" + address.substring(8));
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
