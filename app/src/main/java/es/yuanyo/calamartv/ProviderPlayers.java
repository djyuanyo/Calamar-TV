package es.yuanyo.calamartv;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Player-page links supported inside the Android video screen. */
final class ProviderPlayers {
  private static final Pattern VIDEO_ID = Pattern.compile("(?:^|&)video=[A-Za-z0-9]{5,32}(?:&|$)");
  private static final Pattern DM_PLAYER = Pattern.compile("/player/[A-Za-z0-9]{2,24}\\.html");
  private static final Pattern DM_VIDEO = Pattern.compile("/(?:embed/)?video/([A-Za-z0-9]{5,32})(?:_[^/]*)?/?");
  private static final Pattern DM_SHORT = Pattern.compile("/([A-Za-z0-9]{5,32})/?");
  private static final Pattern VIDARA_VIDEO = Pattern.compile("/(?:v/|e/)?([A-Za-z0-9]{8,24})/?");

  private ProviderPlayers() {}

  private static URI https(String address) {
    try {
      URI uri = URI.create(address.trim());
      return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
          && uri.getUserInfo() == null && uri.getPort() == -1 ? uri : null;
    } catch (RuntimeException invalid) { return null; }
  }

  static String dailymotion(String address) {
    URI uri = https(address);
    if (uri == null) return null;
    String host = uri.getHost().toLowerCase(Locale.ROOT);
    if (host.equals("geo.dailymotion.com") && DM_PLAYER.matcher(uri.getPath()).matches()
        && uri.getRawQuery() != null && VIDEO_ID.matcher(uri.getRawQuery()).find()) {
      return "https://geo.dailymotion.com" + uri.getRawPath() + "?" + uri.getRawQuery();
    }
    Matcher match;
    if (host.equals("dai.ly")) match = DM_SHORT.matcher(uri.getPath());
    else if (host.equals("dailymotion.com") || host.equals("www.dailymotion.com")) match = DM_VIDEO.matcher(uri.getPath());
    else return null;
    return match.matches() ? "https://www.dailymotion.com/embed/video/" + match.group(1) : null;
  }

  static String vidara(String address) {
    URI uri = https(address);
    if (uri == null || !uri.getHost().toLowerCase(Locale.ROOT).matches("(?:www\\.)?vidara\\.(?:to|so)")) return null;
    Matcher match = VIDARA_VIDEO.matcher(uri.getPath());
    return match.matches() ? "https://vidara.to/e/" + match.group(1) : null;
  }

  static String embed(String address) {
    String daily = dailymotion(address);
    return daily != null ? daily : vidara(address);
  }
}
