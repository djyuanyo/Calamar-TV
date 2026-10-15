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
    return sources;
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
}
