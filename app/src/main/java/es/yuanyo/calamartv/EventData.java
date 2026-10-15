package es.yuanyo.calamartv;

import java.io.*;
import java.util.*;
import org.json.*;

/** Public event data, plus a persistent inventory of the provider's own channels. */
public final class EventData {
  private EventData() {}

  public static String read(InputStream in) throws IOException {
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int n;
      while ((n = in.read(buffer)) != -1) {
        if (out.size() + n > 8 * 1024 * 1024) throw new IOException("Respuesta demasiado grande");
        out.write(buffer, 0, n);
      }
      return out.toString("UTF-8");
    } finally {
      in.close();
    }
  }

  public static JSONObject decode(String raw) throws JSONException {
    JSONObject result = new JSONObject(raw);
    JSONArray data = result.getJSONArray("data");
    for (int i = 0; i < data.length(); i++) {
      JSONObject event = data.getJSONObject(i);
      if (event.optString("title").length() == 0) throw new JSONException("Evento sin título");
    }
    return result;
  }

  public static JSONArray mergeChannels(JSONArray previous, JSONArray events, long observedAt)
      throws JSONException {
    TreeMap<String, JSONObject> catalog = new TreeMap<String, JSONObject>();
    for (int i = 0; i < previous.length(); i++) {
      JSONObject item = previous.optJSONObject(i);
      if (item != null) catalog.put(item.getJSONObject("source").optString("url"), item);
    }
    for (int i = 0; i < events.length(); i++) {
      JSONObject event = events.optJSONObject(i);
      if (event == null) continue;
      JSONArray sources = event.optJSONArray("sources");
      if (sources == null) continue;
      for (int j = 0; j < sources.length(); j++) {
        JSONObject source = sources.optJSONObject(j);
        if (source == null || !"own".equals(source.optString("source"))) continue;
        String url = source.optString("player_url", source.optString("url"));
        if (!url.startsWith("https://")) continue;
        JSONObject copy = new JSONObject(source.toString());
        copy.put("url", url);
        copy.put("catalog_seen_at", observedAt);
        JSONObject channelEvent = new JSONObject();
        channelEvent.put("title", copy.optString("name", "Canal"));
        channelEvent.put("sources", new JSONArray().put(copy));
        channelEvent.put("sport_category", event.optString("sport_category"));
        catalog.put(url, new JSONObject().put("source", copy).put("event", channelEvent));
      }
    }
    JSONArray out = new JSONArray();
    for (JSONObject item : catalog.values()) out.put(item);
    return out;
  }

  public static void save(File file, JSONObject payload) throws IOException {
    File temporary = new File(file.getPath() + ".tmp");
    try (FileOutputStream out = new FileOutputStream(temporary)) {
      out.write(payload.toString().getBytes("UTF-8"));
      out.getFD().sync();
    }
    if (!temporary.renameTo(file)) throw new IOException("No se pudo guardar la agenda");
  }
}
