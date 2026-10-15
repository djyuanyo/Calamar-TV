package es.yuanyo.calamartv;

import java.io.*;
import java.net.URI;
import java.util.Locale;
import org.json.*;

/** Channels added by the user. Stored only in the app's private storage. */
public final class UserChannels {
  private UserChannels() {}

  /** Returns the trimmed address if it is an http(s) URL with a host, otherwise null. */
  public static String normalize(String address) {
    if (address == null) return null;
    String trimmed = address.trim();
    try {
      URI uri = new URI(trimmed);
      String scheme = uri.getScheme();
      if (scheme == null) return null;
      scheme = scheme.toLowerCase(Locale.ROOT);
      if (!scheme.equals("http") && !scheme.equals("https")) return null;
      if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
      return trimmed;
    } catch (Exception invalid) {
      return null;
    }
  }

  /** Media type hint from the path; null lets the player detect the container. */
  public static String kind(String address) {
    try {
      String path = new URI(address).getPath();
      if (path == null) return null;
      path = path.toLowerCase(Locale.ROOT);
      if (path.endsWith(".m3u8")) return "hls";
      if (path.endsWith(".mpd")) return "dash";
      if (path.endsWith(".ts")) return "ts";
      return null;
    } catch (Exception invalid) {
      return null;
    }
  }

  public static JSONArray add(JSONArray channels, String name, String address)
      throws JSONException {
    return put(channels, -1, name, address);
  }

  public static JSONArray replace(JSONArray channels, int index, String name, String address)
      throws JSONException {
    if (index < 0 || index >= channels.length()) throw new JSONException("Canal inexistente");
    return put(channels, index, name, address);
  }

  private static JSONArray put(JSONArray channels, int index, String name, String address)
      throws JSONException {
    String url = normalize(address);
    if (url == null) throw new JSONException("Enlace no válido");
    String label = name == null ? "" : name.trim();
    if (label.isEmpty()) label = "Canal " + (index < 0 ? channels.length() + 1 : index + 1);
    JSONArray out = new JSONArray();
    for (int i = 0; i < channels.length(); i++)
      out.put(i == index ? entry(label, url) : channels.get(i));
    if (index < 0) out.put(entry(label, url));
    return out;
  }

  private static JSONObject entry(String name, String url) throws JSONException {
    return new JSONObject().put("name", name).put("url", url);
  }

  public static JSONArray remove(JSONArray channels, int index) {
    JSONArray out = new JSONArray();
    for (int i = 0; i < channels.length(); i++) if (i != index) out.put(channels.opt(i));
    return out;
  }

  /** Keeps only valid entries so a damaged file never breaks the channel list. */
  public static JSONArray decode(String raw) {
    JSONArray out = new JSONArray();
    try {
      JSONArray saved = new JSONArray(raw);
      for (int i = 0; i < saved.length(); i++) {
        JSONObject item = saved.optJSONObject(i);
        if (item == null) continue;
        String url = normalize(item.optString("url"));
        if (url == null) continue;
        String name = item.optString("name").trim();
        out.put(entry(name.isEmpty() ? "Canal " + (out.length() + 1) : name, url));
      }
    } catch (JSONException ignored) {
    }
    return out;
  }

  public static JSONArray load(File file) {
    if (!file.isFile()) return new JSONArray();
    try {
      return decode(EventData.read(new FileInputStream(file)));
    } catch (IOException unreadable) {
      return new JSONArray();
    }
  }

  public static void save(File file, JSONArray channels) throws IOException {
    File temporary = new File(file.getPath() + ".tmp");
    try (FileOutputStream out = new FileOutputStream(temporary)) {
      out.write(channels.toString().getBytes("UTF-8"));
      out.getFD().sync();
    }
    if (!temporary.renameTo(file)) throw new IOException("No se pudieron guardar los canales");
  }
}
