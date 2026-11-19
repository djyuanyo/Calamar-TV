package es.yuanyo.calamartv;

import java.net.URI;
import java.net.URLDecoder;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okio.ByteString;

/** Retarget subsequent signed playlist requests without replacing ExoPlayer or its buffered video. */
final class HlsContinuity {
  private final String root;
  private volatile Map<String,String> urls = Collections.emptyMap();
  HlsContinuity(String initial) { root = identity(initial); }

  static String upstream(String address) {
    try {
      if (!HostingPlayback.isRelay(address)) return null;
      Map<String,String> query = query(URI.create(address));
      if (!query.containsKey("sig")) return null;
      ByteString bytes = ByteString.decodeBase64(query.getOrDefault("seg", ""));
      String decoded = bytes == null ? "" : bytes.utf8();
      URI uri = URI.create(decoded);
      return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null ? decoded : null;
    } catch (Exception invalid) { return null; }
  }
  private static Map<String,String> query(URI uri) throws Exception {
    Map<String,String> values = new LinkedHashMap<>();
    for (String part : (uri.getRawQuery() == null ? "" : uri.getRawQuery()).split("&")) {
      String[] pair = part.split("=",2);
      if (pair.length == 2) values.put(URLDecoder.decode(pair[0],"UTF-8"),URLDecoder.decode(pair[1],"UTF-8"));
    }
    return values;
  }
  private static String identity(String address) {
    try {
      if (!HostingPlayback.isRelay(address)) return null;
      String origin = upstream(address);
      URI uri = URI.create(origin == null ? address : origin);
      Map<String,String> query = query(uri);
      if (origin == null) {
        if (!query.containsKey("seg") || !query.containsKey("sig")) return null;
        query.remove("sig");
      } else { query.remove("token"); query.remove("e"); query.remove("expires"); }
      return (origin == null ? "opaque:" : uri.getScheme()+"://"+uri.getRawAuthority()) + uri.getRawPath() + query;
    } catch (Exception invalid) { return null; }
  }
  String resolve(String address) { String found = urls.get(identity(address)); return found == null ? address : found; }
  boolean update(String fresh, String text) {
    if (root == null || !root.equals(identity(fresh)) || text == null || !text.trim().startsWith("#EXTM3U")
        || !Pattern.compile("(?m)^#(?:EXTINF:|EXT-X-STREAM-INF:)").matcher(text).find()) return false;
    Map<String,String> next = new LinkedHashMap<>(); next.put(root,fresh);
    for (String line : text.split("\\r?\\n")) {
      String value = line.trim();
      if (!value.isEmpty() && !value.startsWith("#")) add(next,fresh,value);
      if (value.matches("^#EXT-X-(MEDIA|I-FRAME-STREAM-INF):.*")) {
        Matcher ref = Pattern.compile("\\bURI=\"([^\"]+)\"").matcher(value);
        if (ref.find()) add(next,fresh,ref.group(1));
      }
    }
    urls = Collections.unmodifiableMap(next);
    return true;
  }
  private static void add(Map<String,String> target,String base,String ref) {
    try {
      String address = URI.create(base).resolve(ref).toString(), origin = upstream(address);
      if (origin == null || !URI.create(origin).getPath().toLowerCase(java.util.Locale.ROOT).endsWith(".m3u8")) return;
      String key = identity(address); if (key != null) target.put(key,address);
    } catch (Exception invalid) { /* Ignore invalid playlist entries. */ }
  }
}
