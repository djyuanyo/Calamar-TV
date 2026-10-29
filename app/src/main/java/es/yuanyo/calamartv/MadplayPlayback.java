package es.yuanyo.calamartv;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Stable hosting URLs only: temporary provider sessions are renewed by the isolated relay. */
final class MadplayPlayback {
  static final String ENDPOINT = "https://calamarmenciano.com/calamar-madplay.php";
  private static String match(String address) {
    try {
      URI u = URI.create(address.trim()); String host = u.getHost();
      if (!"https".equals(u.getScheme()) || u.getUserInfo() != null || u.getPort() != -1 || host == null) return null;
      host = host.toLowerCase(Locale.ROOT);
      if (!(host.equals("mpanrc4imind.my") || host.endsWith(".mpanrc4imind.my") || host.equals("madplay77.ru") || host.endsWith(".madplay77.ru"))) return null;
      Matcher m = Pattern.compile("/(?:[a-z]{2}/)?football/[^/]+-([1-9][0-9]{0,9})/[^/]+\\.html").matcher(u.getPath());
      return m.matches() ? m.group(1) : null;
    } catch (Exception invalid) { return null; }
  }
  static String menu(String page) {
    String id = match(page); return id == null ? null : ENDPOINT + "/match/" + id + "/sources.json";
  }
  static boolean isRelay(String address) {
    return address != null && address.matches(Pattern.quote(ENDPOINT) + "/match/[1-9][0-9]{0,9}/source/[1-9][0-9]{0,9}/index\\.m3u8");
  }
  static List<VideoResolver.Source> parse(String page, String json) throws Exception {
    String id = match(page); if (id == null) throw new IllegalArgumentException("Página de partido no válida.");
    JSONObject data = new JSONObject(json); JSONArray items = data.optJSONArray("items");
    if (items == null) throw new IllegalArgumentException(data.optString("error", "El hosting no devolvió las fuentes del partido."));
    List<VideoResolver.Source> out = new ArrayList<>();
    for (int i = 0; i < items.length(); i++) {
      JSONObject item = items.optJSONObject(i); if (item == null) continue;
      String source = item.optString("id"); if (!source.matches("[1-9][0-9]{0,9}")) continue;
      String expected = ENDPOINT + "/match/" + id + "/source/" + source + "/index.m3u8";
      if (!expected.equals(item.optString("url"))) continue;
      boolean duplicate = false; for (VideoResolver.Source found : out) if (found.url.equals(expected)) duplicate = true;
      if (duplicate) continue;
      String name = item.optString("name").trim();
      out.add(new VideoResolver.Source(name.isEmpty() ? "Señal " + (out.size() + 1) : name, expected));
    }
    if (out.isEmpty()) throw new IllegalArgumentException("El partido no tiene fuentes habilitadas y disponibles.");
    return out;
  }
}
