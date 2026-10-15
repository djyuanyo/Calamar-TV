package es.yuanyo.calamartv;

import java.net.URI;

/** Only the provider's official API player is opened as a first-party document. */
public final class PlayerAddress {
  private PlayerAddress() {}

  public static boolean isOfficialPlayer(String source, String address) {
    if (!"own".equals(source)) return false;
    try {
      URI uri = new URI(address);
      return "https".equalsIgnoreCase(uri.getScheme())
          && "bp.zicotv.cc".equalsIgnoreCase(uri.getHost())
          && uri.getUserInfo() == null
          && uri.getPath().matches("/api/player/[0-9]+/?");
    } catch (Exception invalid) {
      return false;
    }
  }

  public static String officialChannel(String address) {
    URI uri = URI.create(address);
    String path = uri.getPath().replace("/api/player/", "/channels/");
    return "https://bp.zicotv.cc" + path;
  }
}
