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
}
