package es.yuanyo.calamartv;

import java.net.URI;
import java.net.URLEncoder;

/** Same HTTPS origin and HLS engine as the public web player. No URL rewriting. */
public final class BrowserPlayback {
  private BrowserPlayback() {}

  public static boolean supports(String address) {
    try {
      URI uri = URI.create(address);
      return "https".equalsIgnoreCase(uri.getScheme())
          && uri.getHost() != null
          && uri.getUserInfo() == null
          && "hls".equals(UserChannels.kind(address));
    } catch (Exception invalid) {
      return false;
    }
  }

  public static String page(String address) {
    if (!supports(address)) throw new IllegalArgumentException("Fuente HLS no compatible");
    try {
      // Fragments never go to Pages in the HTTP request, referrer or server logs.
      return "https://djyuanyo.github.io/Calamar-TV/direct-player.html#"
          + URLEncoder.encode(address, "UTF-8").replace("+", "%20");
    } catch (java.io.UnsupportedEncodingException impossible) {
      throw new AssertionError(impossible);
    }
  }
}
