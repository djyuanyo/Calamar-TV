package es.yuanyo.calamartv;

import java.net.URI;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Reads sources actually exposed by a player document; never fabricates signed URLs. */
public final class VideoResolver {
  private VideoResolver() {}

  public static final class Source {
    public final String label, url;

    public Source(String label, String url) {
      this.label = label;
      this.url = url;
    }
  }

  /** Fixed public player pages can always be re-read for current sources. */
  public static boolean renewablePage(String address) {
    try {
      URI u = URI.create(address);
      String host = u.getHost();
      return "https".equalsIgnoreCase(u.getScheme()) && u.getUserInfo() == null && host != null
          && (host.equalsIgnoreCase("zicotv.cc") || host.toLowerCase(java.util.Locale.ROOT).endsWith(".zicotv.cc"))
          && u.getPath() != null && u.getPath().matches("/api/player/[0-9]+/?");
    } catch (Exception invalid) { return false; }
  }

  public static String eventApi(String address) {
    try {
      URI u = URI.create(address);
      String host = u.getHost();
      if (!"https".equalsIgnoreCase(u.getScheme()) || u.getUserInfo() != null || host == null
          || !(host.equalsIgnoreCase("zicotv.cc") || host.toLowerCase(java.util.Locale.ROOT).endsWith(".zicotv.cc"))) return null;
      Matcher match = Pattern.compile("/(?:api/v1/)?events/([0-9]+)/?").matcher(u.getPath());
      return match.matches() ? "https://" + u.getRawAuthority() + "/api/v1/events/" + match.group(1) : null;
    } catch (Exception invalid) { return null; }
  }

  public static List<Source> eventPlayers(String json) throws Exception {
    List<Source> out = new ArrayList<>();
    JSONArray entries = new JSONObject(json).getJSONObject("data").optJSONArray("sources");
    if (entries == null) return out;
    for (int i = 0; i < entries.length(); i++) {
      JSONObject entry = entries.optJSONObject(i);
      if (entry == null || entry.optBoolean("locked") || entry.optBoolean("is_premium")) continue;
      addEventPlayer(out, entry, entry, false);
      // Match the web: an event source may be a group with multiple channel players.
      JSONArray streams = entry.optJSONArray("streams");
      if (streams != null) for (int n = 0; n < streams.length(); n++)
        addEventPlayer(out, streams.optJSONObject(n), entry, true);
    }
    return out;
  }

  private static void addEventPlayer(List<Source> out, JSONObject entry, JSONObject parent, boolean nested) {
    if (entry == null || entry.optBoolean("locked") || entry.optBoolean("is_premium")) return;
    String url = entry.optString("player_url");
    if (url.isEmpty()) url = entry.optString("url");
    try {
      URI u = URI.create(url);
      if (!"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null || u.getUserInfo() != null || eventApi(url) != null) return;
      for (Source source : out) if (source.url.equals(url)) return;
      String name = entry.optString("name");
      if (name.isEmpty()) name = parent.optString("name");
      if (name.isEmpty()) name = "Fuente del evento";
      String language = entry.optString("language");
      if (nested && !language.isEmpty()) name += " · " + language;
      out.add(new Source(name, url));
    } catch (Exception invalid) { /* Ignore invalid public entries. */ }
  }

  public static boolean isMedia(String address) {
    try {
      URI u = URI.create(address);
      return "https".equalsIgnoreCase(u.getScheme())
          && u.getHost() != null
          && u.getUserInfo() == null
          && u.getPath() != null
          && u.getPath().toLowerCase(java.util.Locale.ROOT).matches(".*\\.(m3u8|mpd|mp4|webm)$");
    } catch (Exception e) {
      return false;
    }
  }

  public static List<Source> parse(String html, String pageUrl) throws Exception {
    List<Source> sources = new ArrayList<>();
    Matcher assignment =
        Pattern.compile("\\b(?:var|let|const)\\s+ZT_SOURCES\\s*=\\s*(\\[)").matcher(html);
    if (assignment.find()) {
      int start = assignment.start(1), depth = 0;
      boolean quoted = false, escaped = false;
      for (int i = start; i < html.length(); i++) {
        char c = html.charAt(i);
        if (quoted) {
          if (escaped) escaped = false;
          else if (c == '\\') escaped = true;
          else if (c == '"') quoted = false;
        } else if (c == '"') quoted = true;
        else if (c == '[') depth++;
        else if (c == ']' && --depth == 0) {
          JSONArray array = new JSONArray(html.substring(start, i + 1));
          for (int n = 0; n < array.length(); n++) {
            JSONObject s = array.optJSONObject(n);
            if (s != null && !s.optBoolean("locked"))
              add(sources, s.optString("label", "Fuente " + (n + 1)), s.optString("url"), pageUrl);
          }
          return sources; // Do not pick up a locked source elsewhere in the same document.
        }
      }
      throw new IllegalArgumentException("Lista de fuentes incompleta");
    }
    Matcher tags =
        Pattern.compile(
                "<(?:video|source)\\b[^>]*\\bsrc\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE)
            .matcher(html);
    while (tags.find())
      add(sources, "Vídeo " + (sources.size() + 1), tags.group(2).replace("&amp;", "&"), pageUrl);
    if (!sources.isEmpty()) return sources;
    // JW Player pages (LuluStream and similar): sources: [{file:"…m3u8"}], often inside packed JavaScript.
    StringBuilder scripts = new StringBuilder(html);
    Matcher packed = PACKED.matcher(html);
    while (packed.find()) scripts.append('\n').append(unpack(packed));
    Matcher files =
        Pattern.compile("\\bfile\\s*:\\s*([\"'])(https://[^\"']+)\\1").matcher(scripts.toString().replace("\\/", "/"));
    while (files.find()) add(sources, "Vídeo " + (sources.size() + 1), files.group(2), pageUrl);
    return sources;
  }

  private static final Pattern PROCESSING =
      Pattern.compile("video is processing|conversion stage|pending in queue|being processed|is converting", Pattern.CASE_INSENSITIVE);

  /** LuluStream's page for a video still being converted («Video is processing now»). */
  static boolean processing(String html) {
    return html != null && PROCESSING.matcher(html).find();
  }

  private static final Pattern PACKED =
      Pattern.compile(
          "\\}\\('((?:[^'\\\\]++|\\\\.)*+)',\\s*(\\d+),\\s*(\\d+),\\s*'((?:[^'\\\\]++|\\\\.)*+)'\\.split\\('\\|'\\)");
  private static final String DIGITS =
      "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

  /** Expands Dean Edwards' p,a,c,k,e,d packing: each word token is an index into the word list. */
  static String unpack(Matcher packed) {
    String payload = packed.group(1).replace("\\'", "'").replace("\\\\", "\\");
    int base = Integer.parseInt(packed.group(2));
    String[] words = packed.group(4).split("\\|", -1);
    if (base < 2 || base > DIGITS.length()) return "";
    Matcher token = Pattern.compile("\\b\\w+\\b").matcher(payload);
    StringBuffer out = new StringBuffer();
    while (token.find()) {
      long index = 0;
      boolean valid = true;
      for (char c : token.group().toCharArray()) {
        int digit = DIGITS.indexOf(c);
        if (digit < 0 || digit >= base || index > Integer.MAX_VALUE) { valid = false; break; }
        index = index * base + digit;
      }
      String word = valid && index < words.length && !words[(int) index].isEmpty() ? words[(int) index] : token.group();
      token.appendReplacement(out, Matcher.quoteReplacement(word));
    }
    token.appendTail(out);
    return out.toString();
  }

  private static void add(List<Source> sources, String label, String value, String page) {
    try {
      String url = URI.create(page).resolve(value).toString();
      if (!isMedia(url)) return;
      for (Source s : sources) if (s.url.equals(url)) return;
      sources.add(new Source(label, url));
    } catch (Exception invalid) {
      /* Not a playable source. */
    }
  }

  /** Epoch hint, not an assertion about the provider's signature validation. */
  public static long expiryMillis(String address) {
    try {
      String query = URI.create(address).getRawQuery();
      if (query == null) return -1;
      for (String field : query.split("&")) {
        String[] pair = field.split("=", 2);
        if (pair.length != 2) continue;
        String value = URLDecoder.decode(pair[1], "UTF-8");
        if (pair[0].equals("e") || pair[0].equals("expires")) return epoch(value);
        if (pair[0].equals("token")) {
          Matcher m = Pattern.compile("(?:^|-)([0-9]{10})(?:-|$)").matcher(value);
          if (m.find()) return epoch(m.group(1));
        }
      }
    } catch (Exception invalid) {
    }
    return -1;
  }

  private static long epoch(String number) {
    long seconds = Long.parseLong(number);
    return seconds >= 1000000000L && seconds < 10000000000L ? seconds * 1000L : -1;
  }

  public static long renewalDelay(String address, long now) {
    long expiry = expiryMillis(address);
    return expiry > now ? Math.max(1000L, expiry - now - 30000L) : -1;
  }

  /** Opaque Zico tokens still need periodic page lookup; raw media URLs cannot be renewed. */
  public static long pageRenewalDelay(String page, String address, long now) {
    long delay = renewalDelay(address, now);
    if (delay >= 0) return Math.max(15000L, delay);
    if (!renewablePage(page)) return -1;
    return expiryMillis(address) > 0 ? 15000L : 300000L;
  }

  /** A token or list order change must not silently select another CDN. */
  public static int renewedSelection(List<Source> sources, String previous, int fallback) {
    if (previous != null && !previous.isEmpty()) {
      try {
        URI old = URI.create(previous);
        for (int i = 0; i < sources.size(); i++) {
          URI fresh = URI.create(sources.get(i).url);
          if (java.util.Objects.equals(old.getScheme(), fresh.getScheme())
              && java.util.Objects.equals(old.getRawAuthority(), fresh.getRawAuthority())
              && java.util.Objects.equals(old.getRawPath(), fresh.getRawPath())) return i;
        }
      } catch (IllegalArgumentException invalid) { /* Use the previous index if no identity is available. */ }
    }
    return Math.max(0, Math.min(fallback, sources.size() - 1));
  }
}
