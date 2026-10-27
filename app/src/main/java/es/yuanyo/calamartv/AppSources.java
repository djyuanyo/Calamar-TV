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

  static ArrayList<String> forAndroid(List<String> sources) {
    ArrayList<String> out = new ArrayList<>();
    if (sources != null) for (String candidate : sources) {
      String url = UserChannels.normalize(candidate);
      if (url != null && !webOnly(url) && !out.contains(url)) out.add(url);
    }
    return out;
  }
}
