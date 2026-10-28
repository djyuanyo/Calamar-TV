package es.yuanyo.calamartv;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Android playback policy. The shared catalog and the web keep their original sources. */
final class AppSources {
  private AppSources() {}

  static boolean webOnly(String address) {
    return false; // Public Zico sources are supported again; resolution stays on the device.
  }

  /**
   * A channel's links for the app, in the catalog's order but with ZicoTV's last: the direct IPTV links
   * (M3U8 and the like) are tried and listed in «Fuentes» first.
   */
  static ArrayList<String> forAndroid(List<String> sources) {
    ArrayList<String> out = new ArrayList<>(), zico = new ArrayList<>();
    if (sources != null) for (String candidate : sources) {
      String url = UserChannels.normalize(candidate);
      if (url == null || webOnly(url) || out.contains(url) || zico.contains(url)) continue;
      (zico(url) ? zico : out).add(url);
    }
    out.addAll(zico);
    return out;
  }

  /** A link of ZicoTV (zicotv.cc or any of its subdomains). */
  static boolean zico(String address) {
    try {
      String host = URI.create(address).getHost();
      host = host == null ? "" : host.toLowerCase(Locale.ROOT);
      return host.equals("zicotv.cc") || host.endsWith(".zicotv.cc");
    } catch (IllegalArgumentException invalid) {
      return false;
    }
  }
}
