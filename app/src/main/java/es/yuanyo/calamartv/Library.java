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
 * Films, series and documentaries published by hosting/calamar-library.php from the hosting's
 * folders, with TMDB details. Shown only while the administrator has it switched on.
 */
final class Library {
  private Library() {}

  static final String ENDPOINT = "https://calamarmenciano.com/calamar-library.php?action=library";
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

    String label() {
      return season + "x" + String.format(Locale.ROOT, "%02d", episode);
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

    String episodeTitle(Episode e) {
      return title + " · " + e.label() + (e.name.isEmpty() ? "" : " · " + e.name);
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

  /** Only https files of the Calamar hosting are played; the list cannot point the player elsewhere. */
  static final class Media {
    private Media() {}

    static boolean allowed(String address) {
      try {
        java.net.URI u = java.net.URI.create(address);
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        return "https".equalsIgnoreCase(u.getScheme())
            && u.getUserInfo() == null
            && (host.equals("calamarmenciano.com") || host.equals("www.calamarmenciano.com"));
      } catch (Exception e) {
        return false;
      }
    }
  }

  static Data download() throws IOException, JSONException {
    HttpURLConnection c = (HttpURLConnection) new URL(ENDPOINT).openConnection();
    c.setConnectTimeout(10000);
    c.setReadTimeout(20000);
    c.setRequestProperty("Accept", "application/json");
    c.setRequestProperty("User-Agent", PlayerDocument.USER_AGENT);
    try {
      int status = c.getResponseCode();
      if (status != 200) throw new IOException("HTTP " + status);
      return new Data(new JSONObject(Io.read(c.getInputStream())));
    } finally {
      c.disconnect();
    }
  }
}
