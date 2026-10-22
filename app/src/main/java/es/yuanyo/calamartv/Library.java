package es.yuanyo.calamartv;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Films, series and documentaries published by the admin web page from Google Drive folders, with
 * TMDB details. Shown only while the administrator has it switched on.
 */
final class Library {
  private Library() {}

  /**
   * Published by the admin web page to Firestore: «index» names the parts of each section («movies-0»…).
   * Read with the public Firebase key, without signing in; the videos play from Google Drive.
   */
  static final String DOCS = "https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarLibrary/";
  static final String KEY = "AIzaSyB5lJLnPd79iEupekufK5x11SXSqYL4dsk";
  /** Section keys in the published JSON and their names in the menu, in menu order. */
  static final String[][] SECTIONS = {
    {"movies", "Películas"}, {"series", "Series"}, {"documentaries", "Documentales"}
  };

  static boolean visible(JSONObject custom) {
    return custom != null && custom.optBoolean("libraryVisible", false);
  }

  /** The JSON key for a menu name, or null when the name is not a library section. */
  static String section(String menu) {
    for (String[] s : SECTIONS) if (s[1].equals(menu)) return s[0];
    return null;
  }

  static final class Episode {
    final String id, url, name, overview, still;
    final int season, episode;

    Episode(JSONObject e) {
      id = e.optString("id");
      url = e.optString("url");
      season = e.optInt("season", 1);
      episode = e.optInt("episode", 0);
      name = e.optString("name");
      overview = e.optString("overview");
      still = e.optString("still");
    }

    /** «1x01» in the file name is season 1, episode 1: shown as «Capítulo 1» of «Temporada 1». */
    String label() {
      return "Capítulo " + episode;
    }

    /** The episode's name from TMDB when it has one; otherwise «Capítulo N». */
    String title() {
      return name.isEmpty() ? label() : name;
    }

    String seasonLabel() {
      return "Temporada " + season;
    }
  }

  static final class Item {
    final String id, title, url, overview, poster, backdrop;
    final int year, runtime, votes;
    final double rating;
    final boolean series;
    final List<String> genres = new ArrayList<>();
    final List<String[]> cast = new ArrayList<>();
    final List<Episode> episodes = new ArrayList<>();

    Item(JSONObject o) {
      JSONObject t = o.optJSONObject("tmdb");
      if (t == null) t = new JSONObject();
      id = o.optString("id");
      series = "tv".equals(o.optString("kind"));
      title = t.optString("title", "").isEmpty() ? o.optString("title") : t.optString("title");
      year = t.optInt("year", o.optInt("year", 0));
      url = o.optString("url");
      overview = t.optString("overview");
      poster = t.optString("poster");
      backdrop = t.optString("backdrop");
      runtime = t.optInt("runtime", 0);
      votes = t.optInt("votes", 0);
      rating = t.optDouble("rating", 0);
      JSONArray g = t.optJSONArray("genres");
      if (g != null) for (int i = 0; i < g.length(); i++) genres.add(g.optString(i));
      JSONArray c = t.optJSONArray("cast");
      if (c != null)
        for (int i = 0; i < c.length(); i++) {
          JSONObject p = c.optJSONObject(i);
          if (p != null) cast.add(new String[] {p.optString("name"), p.optString("character")});
        }
      JSONArray e = o.optJSONArray("episodes");
      if (e != null)
        for (int i = 0; i < e.length(); i++) {
          JSONObject ep = e.optJSONObject(i);
          if (ep != null && Media.allowed(ep.optString("url"))) episodes.add(new Episode(ep));
        }
    }

    boolean playable() {
      return series ? !episodes.isEmpty() : Media.allowed(url);
    }

    /** «2009 · 162 min · ★ 7,6 (32.000)», leaving out what TMDB did not give. */
    String facts() {
      List<String> parts = new ArrayList<>();
      if (year > 0) parts.add(String.valueOf(year));
      if (series) {
        int seasons = seasons().size();
        parts.add(seasons == 1 ? "1 temporada" : seasons + " temporadas");
        parts.add(episodes.size() == 1 ? "1 capítulo" : episodes.size() + " capítulos");
      } else if (runtime > 0) parts.add(runtime + " min");
      if (rating > 0)
        parts.add(
            "★ " + String.format(new Locale("es", "ES"), "%.1f", rating)
                + (votes > 0 ? " (" + String.format(new Locale("es", "ES"), "%,d", votes) + ")" : ""));
      return String.join(" · ", parts);
    }

    /** Episodes grouped by season, in order. */
    Map<Integer, List<Episode>> seasons() {
      Map<Integer, List<Episode>> out = new LinkedHashMap<>();
      List<Episode> sorted = new ArrayList<>(episodes);
      Collections.sort(
          sorted,
          (a, b) -> a.season != b.season ? Integer.compare(a.season, b.season) : Integer.compare(a.episode, b.episode));
      for (Episode e : sorted) {
        List<Episode> list = out.get(e.season);
        if (list == null) out.put(e.season, list = new ArrayList<>());
        list.add(e);
      }
      return out;
    }

    /** The player's title: «Los hombres de Paco · T1 · Piloto» (or «· Capítulo 1» without a name). */
    String episodeTitle(Episode e) {
      return title + " · T" + e.season + " · " + e.title();
    }

    /** The episode after this one in season and episode order, or null after the last. */
    Episode next(Episode current) {
      List<Episode> all = new ArrayList<>();
      for (List<Episode> season : seasons().values()) all.addAll(season);
      for (int i = 0; i < all.size() - 1; i++) if (all.get(i).id.equals(current.id)) return all.get(i + 1);
      return null;
    }

    Episode episode(String id) {
      for (Episode e : episodes) if (e.id.equals(id)) return e;
      return null;
    }

    /** What «Continuar viendo» keeps to draw its card and come back to this film or episode. */
    JSONObject entry(String section, Episode e) {
      JSONObject o = new JSONObject();
      try {
        o.put("key", e == null ? id : e.id).put("section", section).put("item", id).put("episode", e == null ? "" : e.id)
            .put("url", e == null ? url : e.url).put("title", e == null ? title : episodeTitle(e)).put("name", title)
            .put("sub", e == null ? (year > 0 ? String.valueOf(year) : "") : e.seasonLabel() + " · " + e.title())
            .put("image", e != null && !e.still.isEmpty() ? e.still : !backdrop.isEmpty() ? backdrop : poster);
      } catch (JSONException impossible) {
        throw new IllegalStateException(impossible);
      }
      return o;
    }
  }

  static final class Data {
    final Map<String, List<Item>> sections = new LinkedHashMap<>();
    final String attribution;

    Data(JSONObject json) {
      JSONObject s = json.optJSONObject("sections");
      for (String[] section : SECTIONS) {
        List<Item> items = new ArrayList<>();
        JSONArray a = s == null ? null : s.optJSONArray(section[0]);
        if (a != null)
          for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            Item item = new Item(o);
            if (!item.id.isEmpty() && item.playable()) items.add(item);
          }
        sections.put(section[0], items);
      }
      attribution = json.optString("attribution");
    }

    List<Item> items(String section) {
      List<Item> items = sections.get(section);
      return items == null ? Collections.<Item>emptyList() : items;
    }
  }

  /**
   * «Continuar viendo»: where each film or episode was left on this device. One entry per series (the
   * last episode watched), the 20 most recent, and gone once it has been watched.
   */
  static final class Progress {
    private Progress() {}

    static final int LIMIT = 20;

    static boolean finished(long positionMs, long durationMs) {
      return durationMs >= 300000 && positionMs >= durationMs * 0.95;
    }

    static JSONObject record(JSONObject store, JSONObject entry, long positionMs, long durationMs, long now) {
      JSONObject next = copy(store);
      String key = entry.optString("key");
      if (key.isEmpty() || positionMs < 10000) return next;
      java.util.Iterator<String> keys = store.keys();
      while (keys.hasNext()) {
        String other = keys.next();
        JSONObject saved = store.optJSONObject(other);
        if (!other.equals(key) && saved != null && saved.optString("section").equals(entry.optString("section"))
            && saved.optString("item").equals(entry.optString("item"))) next.remove(other);
      }
      if (finished(positionMs, durationMs)) {
        next.remove(key);
        return next;
      }
      try {
        JSONObject saved = new JSONObject(entry.toString());
        saved.put("position", positionMs).put("duration", Math.max(0, durationMs)).put("at", now);
        next.put(key, saved);
      } catch (JSONException impossible) {
        throw new IllegalStateException(impossible);
      }
      List<JSONObject> all = list(next);
      for (int i = LIMIT; i < all.size(); i++) next.remove(all.get(i).optString("key"));
      return next;
    }

    static JSONObject remove(JSONObject store, String key) {
      JSONObject next = copy(store);
      next.remove(key);
      return next;
    }

    static List<JSONObject> list(JSONObject store) {
      List<JSONObject> out = new ArrayList<>();
      java.util.Iterator<String> keys = store.keys();
      while (keys.hasNext()) {
        JSONObject o = store.optJSONObject(keys.next());
        if (o != null) out.add(o);
      }
      Collections.sort(out, (a, b) -> Long.compare(b.optLong("at"), a.optLong("at")));
      return out;
    }

    private static JSONObject copy(JSONObject store) {
      try {
        return new JSONObject(store.toString());
      } catch (JSONException impossible) {
        return new JSONObject();
      }
    }

    static JSONObject load(android.content.Context context) {
      try {
        return new JSONObject(context.getSharedPreferences("library", android.content.Context.MODE_PRIVATE).getString("progress", "{}"));
      } catch (JSONException broken) {
        return new JSONObject();
      }
    }

    static void save(android.content.Context context, JSONObject store) {
      context.getSharedPreferences("library", android.content.Context.MODE_PRIVATE).edit().putString("progress", store.toString()).apply();
    }
  }

  /** Only https files of the Calamar hosting are played; the list cannot point the player elsewhere. */
  static final class Media {
    private Media() {}

    static boolean allowed(String address) {
      try {
        java.net.URI u = java.net.URI.create(address);
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        return "https".equalsIgnoreCase(u.getScheme())
            && u.getUserInfo() == null
            && (host.equals("calamarmenciano.com") || host.equals("www.calamarmenciano.com")
                || (host.equals("www.googleapis.com") && u.getPath() != null && u.getPath().matches("/drive/v3/files/[A-Za-z0-9_-]+")));
      } catch (Exception e) {
        return false;
      }
    }
  }

  /** 1:02:05 or 12:34. */
  static String clock(long ms) {
    long s = Math.max(0, ms / 1000), h = s / 3600, m = s / 60 % 60;
    return h > 0 ? String.format(Locale.ROOT, "%d:%02d:%02d", h, m, s % 60) : String.format(Locale.ROOT, "%d:%02d", m, s % 60);
  }

  static Data download() throws IOException, JSONException {
    JSONObject index = part("index");
    JSONObject library = new JSONObject(), sections = new JSONObject();
    JSONObject counts = index == null ? null : index.optJSONObject("sections");
    if (counts != null) for (java.util.Iterator<String> keys = counts.keys(); keys.hasNext(); ) {
      String section = keys.next();
      JSONArray items = new JSONArray();
      for (int n = 0; n < Math.min(counts.optInt(section), 200); n++) {
        JSONObject p = part(section + "-" + n);
        JSONArray list = p == null ? null : p.optJSONArray("items");
        if (list != null) for (int i = 0; i < list.length(); i++) items.put(list.get(i));
      }
      sections.put(section, items);
    }
    library.put("sections", sections).put("attribution", index == null ? "" : index.optString("attribution"));
    return new Data(library);
  }

  /** One published part, or null when it does not exist (nothing published yet). */
  static JSONObject part(String name) throws IOException, JSONException {
    String body;
    try { body = get(DOCS + name + "?key=" + KEY); }
    catch (java.io.FileNotFoundException missing) { return null; }
    catch (IOException error) { if ("HTTP 404".equals(error.getMessage())) return null; throw error; }
    return new JSONObject(new JSONObject(body).getJSONObject("fields").getJSONObject("json").getString("stringValue"));
  }

  static String get(String address) throws IOException {
    HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
    c.setConnectTimeout(10000);
    c.setReadTimeout(20000);
    c.setRequestProperty("Accept", "application/json");
    c.setRequestProperty("User-Agent", PlayerDocument.USER_AGENT);
    try {
      int status = c.getResponseCode();
      if (status != 200) throw new IOException("HTTP " + status);
      return Io.read(c.getInputStream());
    } finally {
      c.disconnect();
    }
  }

}
