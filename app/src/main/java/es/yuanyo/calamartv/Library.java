package es.yuanyo.calamartv;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
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

  /** The web page of a section: «peliculas», «series» or «documentales». */
  static String page(String section) {
    return section.equals("series") ? "series" : section.equals("documentaries") ? "documentales" : "peliculas";
  }

  /** The JSON key for a menu name, or null when the name is not a library section. */
  static String section(String menu) {
    for (String[] s : SECTIONS) if (s[1].equals(menu)) return s[0];
    return null;
  }

  static final class Episode {
    final String id, url, name, overview, still;
    final int season, episode;
    /** The day it arrived in the library (YYYY-MM-DD or empty), for «Nuevo episodio». */
    final String addedAt;
    /** Its length in minutes from TMDB (0 when unknown), and the day it first aired (YYYY-MM-DD or empty). */
    final int runtime;
    final String aired;

    Episode(JSONObject e) {
      id = e.optString("id");
      aired = e.optString("aired");
      runtime = e.optInt("runtime", 0);
      addedAt = e.optString("addedAt");
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

  static final long DAY = 86400000L;

  private static long day(String date) {
    if (date == null || !date.matches("\\d{4}-\\d{2}-\\d{2}.*")) return Long.MIN_VALUE;
    java.util.Calendar c = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"));
    c.clear();
    c.set(Integer.parseInt(date.substring(0, 4)), Integer.parseInt(date.substring(5, 7)) - 1, Integer.parseInt(date.substring(8, 10)));
    return c.getTimeInMillis();
  }

  private static int yearOf(long now) {
    java.util.Calendar c = java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC"));
    c.setTimeInMillis(now);
    return c.get(java.util.Calendar.YEAR);
  }

  /** Released in the last 12 months (by its TMDB date; without one, a title of this year), as on the web. */
  static boolean recentRelease(Item item, long now) {
    long at = day(item.released);
    if (at != Long.MIN_VALUE) return at <= now && now - at <= 365 * DAY;
    return item.year == yearOf(now);
  }

  /** «Recién llegada», as on Netflix: a title of this year that arrived in the library in the last month. */
  static boolean newArrival(Item item, long now) {
    long added = day(item.addedAt);
    return item.year == yearOf(now) && added != Long.MIN_VALUE && now - added <= 31 * DAY && added <= now + DAY;
  }

  /** The titles that pass the filters (as filterLibrary on the web); only: "estrenos", "nuevas" or ""; order: "", "added", "year", "rating", "name". */
  static List<Item> filter(List<Item> items, String genre, int year, String platform, String only, String order, long now) {
    List<Item> out = new ArrayList<>();
    for (Item item : items) {
      if (!genre.isEmpty() && !item.genres.contains(genre)) continue;
      if (year > 0 && item.year != year) continue;
      if (!platform.isEmpty() && !item.providers.contains(platform)) continue;
      if (only.equals("estrenos") && !recentRelease(item, now)) continue;
      if (only.equals("nuevas") && !newArrival(item, now)) continue;
      out.add(item);
    }
    java.text.Collator collator = java.text.Collator.getInstance(Locale.forLanguageTag("es-ES"));
    if (order.equals("added")) Collections.sort(out, (a, b) -> b.addedAt.compareTo(a.addedAt));
    else if (order.equals("year")) Collections.sort(out, (a, b) -> Integer.compare(b.year, a.year));
    else if (order.equals("rating")) Collections.sort(out, (a, b) -> Double.compare(b.rating, a.rating));
    else if (order.equals("name")) Collections.sort(out, (a, b) -> collator.compare(a.title, b.title));
    return out;
  }

  static String youtubeTrailer(String value) {
    if (value == null) return "";
    value = value.trim();
    if (value.matches("[A-Za-z0-9_-]{11}")) return value;
    try {
      java.net.URI uri = java.net.URI.create(value);
      if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null) return "";
      String host = uri.getHost(), id = "";
      if ("youtu.be".equalsIgnoreCase(host)) id = uri.getPath().substring(1);
      else if (host != null && java.util.Arrays.asList("youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com").contains(host.toLowerCase(java.util.Locale.ROOT))) {
        if ("/watch".equals(uri.getPath())) {
          for (String part : (uri.getRawQuery() == null ? "" : uri.getRawQuery()).split("&"))
            if (part.startsWith("v=")) id = java.net.URLDecoder.decode(part.substring(2), "UTF-8");
        } else if (uri.getPath().matches("/(embed|shorts|live)/.*")) id = uri.getPath().split("/")[2];
      }
      return id.matches("[A-Za-z0-9_-]{11}") ? id : "";
    } catch (Exception ignored) { return ""; }
  }

  static final class Item {
    final String id, title, url, overview, poster, backdrop;
    final int year, runtime, votes;
    final double rating;
    final boolean series;
    final List<String> genres = new ArrayList<>();
    final List<String[]> cast = new ArrayList<>();
    final List<Episode> episodes = new ArrayList<>();
    /** «Saltar intro» and «Siguiente capítulo» times set in the admin page (or empty). */
    final JSONObject skip;
    /** TMDB id of the series (0 without a TMDB record), to ask TheIntroDB for each episode's times. */
    final int tmdbId;
    /** «En portada»: when the administrator marked it (0 when not); and its place in the weekly top (0 outside). */
    final long featured;
    final int trend;
    /** TMDB release date (YYYY-MM-DD or empty), the day it arrived in the library, and its platforms in Spain. */
    final String released, addedAt;
    final List<String> providers = new ArrayList<>();
    /** Where it was made (TMDB country codes) and its original language, for «Películas españolas». */
    final List<String> countries = new ArrayList<>();
    final String language;
    /** The logo of each platform (TMDB's square icons), by name. */
    final Map<String, String> logos = new LinkedHashMap<>();
    /** The YouTube key of its trailer in Spanish (or empty), and «Creada por» / «Dirigida por». */
    final String trailer;
    final List<String> creators = new ArrayList<>();
    /** The series' last aired episode (TMDB): season, number and day, for «Nuevo episodio». */
    final int lastSeason, lastEpisode;
    final String lastAired;

    Item(JSONObject o) {
      JSONObject t = o.optJSONObject("tmdb");
      if (t == null) t = new JSONObject();
      id = o.optString("id");
      featured = o.optLong("featured", 0);
      trend = o.optInt("trend", 0);
      series = "tv".equals(o.optString("kind"));
      JSONObject s = o.optJSONObject("skip");
      skip = s == null ? new JSONObject() : s;
      tmdbId = "unmatched".equals(o.optString("status")) || o.optJSONObject("tmdb") == null ? 0 : o.optJSONObject("tmdb").optInt("id", 0);
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
      released = t.optString("released");
      addedAt = o.optString("addedAt");
      language = t.optString("language");
      JSONObject le = t.optJSONObject("lastEpisode");
      lastSeason = le == null ? -1 : le.optInt("season", -1);
      lastEpisode = le == null ? -1 : le.optInt("episode", -1);
      lastAired = le == null ? "" : le.optString("aired");
      trailer = youtubeTrailer(o.has("trailerUrl") ? o.optString("trailerUrl") : t.optString("trailer"));
      JSONArray cr = t.optJSONArray("creators");
      if (cr != null) for (int i = 0; i < cr.length() && i < 4; i++) if (!cr.optString(i).trim().isEmpty()) creators.add(cr.optString(i).trim());
      JSONObject lg = t.optJSONObject("logos");
      if (lg != null)
        for (java.util.Iterator<String> it = lg.keys(); it.hasNext(); ) {
          String k = it.next();
          if (lg.optString(k).startsWith("https://")) logos.put(k, lg.optString(k));
        }
      JSONArray cn = t.optJSONArray("countries");
      if (cn != null) for (int i = 0; i < cn.length(); i++) if (!cn.optString(i).isEmpty()) countries.add(cn.optString(i));
      JSONArray pv = t.optJSONArray("providers");
      if (pv != null) for (int i = 0; i < pv.length(); i++) if (!pv.optString(i).isEmpty()) providers.add(pv.optString(i));
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
        if (e != null) {
          int[] marks = skipMarks(skip, e.season);
          o.put("intro_start", marks[0]).put("intro_end", marks[1]).put("credits", marks[2]).put("has_next", next(e) != null)
              .put("manual_intro", marks[0] >= 0).put("manual_credits", marks[4] > 0)
              .put("tmdb", tmdbId).put("season", e.season).put("episode_number", e.episode);
        }
      } catch (JSONException impossible) {
        throw new IllegalStateException(impossible);
      }
      return o;
    }
  }

  // ---- Netflix-style section page (browseRows in web/library.js builds the same rows) ----

  /** One row of a section page; kind: "poster", "top" (big numbers), "big" (large posters) or "continue". */
  static final class Row {
    final String key, title, kind;
    final List<Item> items;

    Row(String key, String title, String kind, List<Item> items) {
      this.key = key;
      this.title = title;
      this.kind = kind;
      this.items = items.size() > ROW_LIMIT ? new ArrayList<>(items.subList(0, ROW_LIMIT)) : items;
    }
  }

  static final int ROW_LIMIT = 40;
  static final String[][] GENRE_ROWS = {
    {"terror", "", "Terror"},
    {"scifi", "Ciencia ficción y fantasía", "Ciencia ficción", "Fantasía", "Sci-Fi & Fantasy"},
    {"comedy", "¿Quieres echarte unas risas?", "Comedia"},
    {"thriller", "Thrillers que te mantendrán en vilo", "Suspense", "Thriller"},
    {"action", "Acción a tope", "Acción", "Action & Adventure"},
    {"drama", "Dramas que enganchan", "Drama"},
    {"crime", "Crimen e investigación", "Crimen"},
    {"family", "Para ver en familia", "Animación", "Familia", "Kids"},
    {"adventure", "Grandes aventuras", "Aventura"},
    {"romance", "Historias de amor", "Romance"},
    {"mystery", "Misterios por resolver", "Misterio"},
  };

  /** «película», «serie», «documental». */
  static String one(String section) {
    return section.equals("series") ? "serie" : section.equals("documentaries") ? "documental" : "película";
  }

  static String label(String section) {
    for (String[] s : SECTIONS) if (s[0].equals(section)) return s[1];
    return "";
  }

  /** Made in Spain (TMDB production countries), or in Spanish when TMDB gives no country. */
  static boolean spanish(Item item) {
    return item.countries.isEmpty() ? "es".equals(item.language) : item.countries.contains("ES");
  }

  private static final java.util.Comparator<Item> INTEREST = (a, b) -> {
    int ta = a.trend > 0 ? a.trend : 999, tb = b.trend > 0 ? b.trend : 999;
    if (ta != tb) return Integer.compare(ta, tb);
    int added = b.addedAt.compareTo(a.addedAt);
    return added != 0 ? added : Double.compare(b.rating, a.rating);
  };

  static String madridDay(long now) {
    java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
    f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
    return f.format(new java.util.Date(now));
  }

  /** A number from 0 to 1 that changes every day for each title (the same as dailyLuck on the web). */
  static double dailyLuck(String day, String id) {
    long h = 2166136261L;
    String text = day + "|" + id;
    for (int i = 0; i < text.length(); ) {
      int cp = text.codePointAt(i);
      i += Character.charCount(cp);
      h = ((h ^ cp) * 16777619L) & 0xffffffffL;
    }
    return h / 4294967296.0;
  }

  /** «Recomendaciones de hoy para ti»: a new pick every day, first the genres this device watches, without those already started. */
  static List<Item> todaysPicks(List<Item> items, java.util.Set<String> watched, String day, int size) {
    java.util.Set<String> liked = new java.util.HashSet<>();
    for (Item item : items) if (watched.contains(item.id)) liked.addAll(item.genres);
    final Map<Item, Double> score = new java.util.HashMap<>();
    List<Item> out = new ArrayList<>();
    for (Item item : items) {
      if (watched.contains(item.id)) continue;
      int common = 0;
      for (String g : item.genres) if (liked.contains(g)) common++;
      score.put(item, common + dailyLuck(day, item.id));
      out.add(item);
    }
    Collections.sort(out, (a, b) -> Double.compare(score.get(b), score.get(a)));
    return out.size() > size ? new ArrayList<>(out.subList(0, size)) : out;
  }

  private static String plain(String s) {
    return java.text.Normalizer.normalize(s.toLowerCase(new Locale("es", "ES")), java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "");
  }

  /** The rows of a section page, in the web's order; empty rows are left out except «Seguir viendo» (filled by the page). */
  static List<Row> browseRows(String section, List<Item> items, java.util.Set<String> watched, String name, long now) {
    List<Row> rows = new ArrayList<>();
    String label = label(section);
    java.util.Set<String> used = new java.util.HashSet<>();
    List<Item> spanish = new ArrayList<>();
    for (Item item : items) if (spanish(item)) spanish.add(item);
    Collections.sort(spanish, INTEREST);
    add(rows, "spanish", section.equals("series") ? "Series españolas" : section.equals("documentaries") ? "Documentales españoles" : "Películas españolas", spanish, "poster");
    add(rows, "today", "Recomendaciones de hoy para ti", todaysPicks(items, watched, madridDay(now), 15), "poster");
    if (!section.equals("documentaries")) {
      List<Item> top = new ArrayList<>();
      for (Item item : items) if (item.trend > 0) top.add(item);
      Collections.sort(top, (a, b) -> Integer.compare(a.trend, b.trend));
      if (top.size() > 10) top = new ArrayList<>(top.subList(0, 10));
      add(rows, "top", top.size() > 1 ? "Las " + top.size() + " " + label.toLowerCase(Locale.ROOT) + " más populares de la semana" : "La " + one(section) + " más popular de la semana", top, "top");
    }
    // Horror has the dark banner of «Especial Halloween», with «Descubrir todo».
    genre(rows, GENRE_ROWS[0], label + " de terror", items, used, "horror");
    // Large posters: what arrived lately («Recién llegada») and series with a new episode, the newest first.
    add(rows, "new", "Novedades en Calamar TV", freshTitles(items, now), "big");
    rows.add(new Row("continue", name.isEmpty() ? "Seguir viendo" : "Seguir viendo para " + name, "continue", new ArrayList<>()));
    genre(rows, GENRE_ROWS[1], GENRE_ROWS[1][1], items, used);
    genre(rows, GENRE_ROWS[2], GENRE_ROWS[2][1], items, used);
    for (int i = 3; i < GENRE_ROWS.length; i++) genre(rows, GENRE_ROWS[i], GENRE_ROWS[i][1], items, used);
    // The other genres follow as «Películas de …», the most common first; the section's own genre has no row.
    final Map<String, Integer> counts = new LinkedHashMap<>();
    for (Item item : items) for (String g : item.genres) if (!used.contains(g) && !plain(g).equals(plain(one(section)))) counts.put(g, counts.containsKey(g) ? counts.get(g) + 1 : 1);
    final java.text.Collator collator = java.text.Collator.getInstance(Locale.forLanguageTag("es-ES"));
    List<String> rest = new ArrayList<>(counts.keySet());
    Collections.sort(rest, (a, b) -> counts.get(a).equals(counts.get(b)) ? collator.compare(a, b) : Integer.compare(counts.get(b), counts.get(a)));
    for (String g : rest) {
      List<Item> list = new ArrayList<>();
      for (Item item : items) if (item.genres.contains(g)) list.add(item);
      Collections.sort(list, INTEREST);
      add(rows, "genre:" + g, label + " de " + g.toLowerCase(new Locale("es", "ES")), list, "poster");
    }
    return rows;
  }

  private static void add(List<Row> rows, String key, String title, List<Item> items, String kind) {
    if (!items.isEmpty()) rows.add(new Row(key, title, kind, items));
  }

  private static void genre(List<Row> rows, String[] row, String title, List<Item> items, java.util.Set<String> used) {
    genre(rows, row, title, items, used, "poster");
  }

  private static void genre(List<Row> rows, String[] row, String title, List<Item> items, java.util.Set<String> used, String kind) {
    List<String> genres = Arrays.asList(row).subList(2, row.length);
    used.addAll(genres);
    List<Item> list = new ArrayList<>();
    for (Item item : items) for (String g : item.genres) if (genres.contains(g)) { list.add(item); break; }
    Collections.sort(list, INTEREST);
    add(rows, row[0], title, list, kind);
  }

  static final int NEW_EPISODE_DAYS = 14;

  /** The day the newest episode of the library first aired (TMDB), as lastEpisodeDay on the web. */
  private static String lastEpisodeDay(Item item) {
    String last = "";
    for (Episode e : item.episodes) if (e.aired.matches("\\d{4}-\\d{2}-\\d{2}") && e.aired.compareTo(last) > 0) last = e.aired;
    if (item.lastAired.matches("\\d{4}-\\d{2}-\\d{2}") && item.lastAired.compareTo(last) > 0)
      for (Episode e : item.episodes) if (e.season == item.lastSeason && e.episode == item.lastEpisode) { last = item.lastAired; break; }
    return last;
  }

  /** «Nuevo episodio»: the series has an episode that first aired in the last two weeks (its real date, not the upload). */
  static boolean newEpisode(Item item, long now) {
    long at = day(lastEpisodeDay(item));
    return item.series && at != Long.MIN_VALUE && now - at <= NEW_EPISODE_DAYS * DAY && at <= now + DAY;
  }

  /** The red label of a poster: «Nuevo episodio», «Recién llegada» or "". */
  static String posterLabel(Item item, long now) {
    return newEpisode(item, now) ? "Nuevo episodio" : newArrival(item, now) ? "Recién llegada" : "";
  }

  private static String freshDay(Item item, long now) {
    return newEpisode(item, now) ? lastEpisodeDay(item) : item.addedAt;
  }

  /** «Novedades en Calamar TV»: new arrivals and series with a new episode, the newest first. */
  static List<Item> freshTitles(List<Item> items, final long now) {
    List<Item> out = new ArrayList<>();
    for (Item item : items) if (!posterLabel(item, now).isEmpty()) out.add(item);
    Collections.sort(out, (a, b) -> freshDay(b, now).compareTo(freshDay(a, now)));
    return out;
  }

  /** The slider at the top of a section: what is new, then the weekly top; without either, the best rated. */
  static List<Item> heroTitles(List<Item> items, long now, int size) {
    java.util.LinkedHashSet<Item> out = new java.util.LinkedHashSet<>(freshTitles(items, now));
    List<Item> top = new ArrayList<>();
    for (Item item : items) if (item.trend > 0) top.add(item);
    Collections.sort(top, (a, b) -> Integer.compare(a.trend, b.trend));
    out.addAll(top);
    if (out.isEmpty()) {
      List<Item> rated = new ArrayList<>();
      for (Item item : items) if (!item.backdrop.isEmpty() || !item.poster.isEmpty()) rated.add(item);
      Collections.sort(rated, (a, b) -> Double.compare(b.rating, a.rating));
      out.addAll(rated);
    }
    List<Item> list = new ArrayList<>(out);
    return list.size() > size ? new ArrayList<>(list.subList(0, size)) : list;
  }

  /** The platforms of a list of titles, the one with most titles first: [name, logo, count]. */
  static List<String[]> platforms(List<Item> items) {
    return platforms(items, null);
  }

  /**
   * As platformsOf on the web: the catalog's `platforms` (set in the admin page: [{name, logo, hidden}] in
   * order) go first in that order with their own logo, hidden ones are left out, the rest follow by titles.
   */
  static List<String[]> platforms(List<Item> items, JSONArray settings) {
    List<String[]> all = platformsByTitles(items);
    final List<String> order = new ArrayList<>();
    java.util.Set<String> hidden = new java.util.HashSet<>();
    Map<String, String> logos = new java.util.HashMap<>();
    for (int i = 0; settings != null && i < settings.length(); i++) {
      JSONObject p = settings.optJSONObject(i);
      if (p == null || p.optString("name").isEmpty()) continue;
      order.add(p.optString("name"));
      if (p.optBoolean("hidden", false)) hidden.add(p.optString("name"));
      String logo = p.optString("logo");
      if (logo.startsWith("https://") || logo.startsWith("data:image/")) logos.put(p.optString("name"), logo);
    }
    List<String[]> out = new ArrayList<>();
    for (String[] p : all) {
      if (hidden.contains(p[0])) continue;
      if (logos.containsKey(p[0])) p[1] = logos.get(p[0]);
      out.add(p);
    }
    Collections.sort(out, (a, b) -> {
      int ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return Integer.compare(ia < 0 ? order.size() : ia, ib < 0 ? order.size() : ib);
    });
    return out;
  }

  private static List<String[]> platformsByTitles(List<Item> items) {
    final Map<String, String[]> found = new LinkedHashMap<>();
    for (Item item : items)
      for (String name : item.providers) {
        String[] p = found.get(name);
        if (p == null) found.put(name, p = new String[] {name, "", "0"});
        p[2] = String.valueOf(Integer.parseInt(p[2]) + 1);
        if (p[1].isEmpty() && item.logos.containsKey(name)) p[1] = item.logos.get(name);
      }
    List<String[]> out = new ArrayList<>(found.values());
    final java.text.Collator collator = java.text.Collator.getInstance(Locale.forLanguageTag("es-ES"));
    Collections.sort(out, (a, b) -> a[2].equals(b[2]) ? collator.compare(a[0], b[0]) : Integer.compare(Integer.parseInt(b[2]), Integer.parseInt(a[2])));
    return out;
  }

  /** Every title of a platform (every section together) and its rows: «En primer plano», by section and by genre. */
  static List<Row> platformRows(Data data, String name, long now, List<Item> all) {
    for (String[] section : SECTIONS) for (Item item : data.items(section[0])) if (item.providers.contains(name)) all.add(item);
    List<Row> rows = new ArrayList<>();
    List<Item> spotlight = heroTitles(all, now, 15);
    if (spotlight.isEmpty()) { spotlight = new ArrayList<>(all); Collections.sort(spotlight, INTEREST); }
    add(rows, "spotlight", "En primer plano", spotlight, "poster");
    for (String[] section : SECTIONS) {
      List<Item> mine = new ArrayList<>();
      for (Item item : data.items(section[0])) if (item.providers.contains(name)) mine.add(item);
      Collections.sort(mine, INTEREST);
      add(rows, section[0], section[1], mine, "poster");
    }
    java.util.Set<String> used = new java.util.HashSet<>();
    for (String[] row : GENRE_ROWS) genre(rows, row, row[0].equals("terror") ? "Terror" : row[1], all, used);
    java.util.TreeSet<String> rest = new java.util.TreeSet<>(java.text.Collator.getInstance(Locale.forLanguageTag("es-ES")));
    for (Item item : all) for (String g : item.genres) if (!used.contains(g)) rest.add(g);
    for (String g : rest) {
      List<Item> list = new ArrayList<>();
      for (Item item : all) if (item.genres.contains(g)) list.add(item);
      Collections.sort(list, INTEREST);
      add(rows, "genre:" + g, g, list, "poster");
    }
    return rows;
  }

  /** «Similares»: titles of the same section sharing genres with this one, the closest first (as similarTitles on the web). */
  static List<Item> similar(Data data, String section, Item item, int size) {
    List<Item> close = new ArrayList<>(), all = new ArrayList<>();
    final Map<Item, Integer> shared = new java.util.HashMap<>();
    for (Item other : data.items(section)) {
      if (other.id.equals(item.id)) continue;
      int n = 0;
      for (String g : other.genres) if (item.genres.contains(g)) n++;
      shared.put(other, n);
      all.add(other);
      if (n > 0) close.add(other);
    }
    List<Item> out = close.isEmpty() ? all : close;
    Collections.sort(out, (a, b) -> !shared.get(a).equals(shared.get(b)) ? Integer.compare(shared.get(b), shared.get(a)) : Double.compare(b.rating, a.rating));
    return out.size() > size ? new ArrayList<>(out.subList(0, size)) : out;
  }

  /** The episode to play from a series' page: the one left half watched most recently, else the first. */
  static Episode resumeEpisode(Item item, JSONObject progress) {
    Episode first = null, latest = null;
    long at = -1;
    for (List<Episode> season : item.seasons().values())
      for (Episode e : season) {
        if (first == null) first = e;
        JSONObject saved = progress == null ? null : progress.optJSONObject(e.id);
        if (saved != null && saved.optLong("at", 0) > at) { at = saved.optLong("at", 0); latest = e; }
      }
    return latest != null ? latest : first;
  }

  // ---- Especial Halloween: 1 October to 2 November (Madrid), every horror title, as on the web ----

  static boolean halloweenOn(long now) {
    String day = madridDay(now);
    int month = Integer.parseInt(day.substring(5, 7)), date = Integer.parseInt(day.substring(8, 10));
    return month == 10 || (month == 11 && date <= 2);
  }

  /** Every horror title (TMDB genre «Terror») with its section key: [section, item]. */
  static List<Object[]> horror(Data data) {
    List<Object[]> out = new ArrayList<>();
    if (data == null) return out;
    for (String[] section : SECTIONS) {
      List<Item> list = new ArrayList<>();
      for (Item item : data.items(section[0])) if (item.genres.contains("Terror")) list.add(item);
      Collections.sort(list, INTEREST);
      for (Item item : list) out.add(new Object[] {section[0], item});
    }
    final java.util.Comparator<Item> interest = INTEREST;
    Collections.sort(out, (a, b) -> interest.compare((Item) a[1], (Item) b[1]));
    return out;
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

    /** The section key of a title. */
    String sectionOf(Item item) {
      for (String[] section : SECTIONS) if (items(section[0]).contains(item)) return section[0];
      return null;
    }

    /** Titles «En portada», in the order they were marked. */
    List<Item> featured() {
      List<Item> out = new ArrayList<>();
      for (String[] section : SECTIONS) for (Item item : items(section[0])) if (item.featured > 0) out.add(item);
      Collections.sort(out, (a, b) -> Long.compare(a.featured, b.featured));
      return out;
    }

    /** The weekly top of one section (films or series, set from TMDB in the admin page), at most 10. */
    List<Item> top(String section) {
      List<Item> out = new ArrayList<>();
      for (Item item : items(section)) if (item.trend > 0) out.add(item);
      Collections.sort(out, (a, b) -> Integer.compare(a.trend, b.trend));
      return out.size() > 10 ? new ArrayList<>(out.subList(0, 10)) : out;
    }

    Item find(String section, String id) {
      for (Item item : items(section)) if (item.id.equals(id)) return item;
      return null;
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

    static JSONObject loadRemoved(android.content.Context context) {
      try {
        return new JSONObject(context.getSharedPreferences("library", android.content.Context.MODE_PRIVATE).getString("progress_removed", "{}"));
      } catch (JSONException broken) {
        return new JSONObject();
      }
    }

    /** Saves the row; what disappeared from it is noted as removed now, and the account's copy follows. */
    static void save(android.content.Context context, JSONObject store) {
      JSONObject removed = removals(load(context), store, loadRemoved(context), System.currentTimeMillis());
      write(context, store, removed);
      ProgressSync.pushSoon(context);
    }

    static void write(android.content.Context context, JSONObject store, JSONObject removed) {
      context.getSharedPreferences("library", android.content.Context.MODE_PRIVATE).edit()
          .putString("progress", store.toString()).putString("progress_removed", removed.toString()).apply();
    }

    /** The removals after going from `before` to `after`: what left the row now, minus what came back later. */
    static JSONObject removals(JSONObject before, JSONObject after, JSONObject removed, long now) {
      JSONObject gone = copy(removed);
      try {
        java.util.Iterator<String> keys = before.keys();
        while (keys.hasNext()) {
          String key = keys.next();
          if (!after.has(key)) gone.put(key, now);
        }
        keys = after.keys();
        while (keys.hasNext()) {
          String key = keys.next();
          JSONObject entry = after.optJSONObject(key);
          if (entry != null && gone.optLong(key, Long.MAX_VALUE) < entry.optLong("at")) gone.remove(key);
        }
      } catch (JSONException impossible) {
        throw new IllegalStateException(impossible);
      }
      return gone;
    }

    // The account's copy in Firestore (calamarProgress/<uid>), the same the web writes (library.js):
    // sections by key, positions in seconds, `at` in milliseconds and `removed` {key: when}.
    static final long REMOVED_DAYS = 60;
    static final int REMOVED_LIMIT = 200;
    private static final String[] SHARED = {"key", "section", "item", "episode", "name", "sub", "image"};

    static JSONObject toCloud(JSONObject store, JSONObject removed) {
      JSONObject entries = new JSONObject();
      try {
        for (JSONObject e : list(store)) {
          if (e.optString("key").isEmpty() || !knownSection(e.optString("section"))) continue;
          JSONObject o = new JSONObject();
          for (String field : SHARED) o.put(field, e.optString(field));
          o.put("position", e.optLong("position") / 1000).put("duration", e.optLong("duration") / 1000).put("at", e.optLong("at"));
          entries.put(e.optString("key"), o);
        }
        return new JSONObject().put("entries", entries).put("removed", copy(removed));
      } catch (JSONException impossible) {
        throw new IllegalStateException(impossible);
      }
    }

    /**
     * The shared copy as this device keeps it. An entry this device already had keeps what only the app
     * stores (link, intro and credits marks); one from another device gets them from the library when played.
     */
    static JSONObject fromCloud(JSONObject cloud, JSONObject local) {
      JSONObject store = new JSONObject();
      JSONObject entries = cloud.optJSONObject("entries");
      if (entries == null) return store;
      try {
        java.util.Iterator<String> keys = entries.keys();
        while (keys.hasNext()) {
          String key = keys.next();
          JSONObject e = entries.optJSONObject(key);
          if (e == null || !knownSection(e.optString("section")) || e.optString("item").isEmpty()) continue;
          JSONObject mine = local.optJSONObject(key);
          JSONObject o = mine != null ? new JSONObject(mine.toString()) : new JSONObject();
          for (String field : SHARED) o.put(field, e.optString(field));
          if (!o.has("title")) o.put("title", e.optString("name"));
          o.put("position", e.optLong("position") * 1000).put("duration", e.optLong("duration") * 1000).put("at", e.optLong("at"));
          store.put(key, o);
        }
      } catch (JSONException impossible) {
        throw new IllegalStateException(impossible);
      }
      return store;
    }

    /**
     * Two shared copies joined: for each title the latest thing done on any device wins (watching it
     * again, or removing it); one entry per series and the 20 most recent. As mergeProgress in library.js.
     */
    static JSONObject merge(JSONObject a, JSONObject b, long now) {
      JSONObject entries = new JSONObject(), removed = new JSONObject();
      java.util.Set<String> keys = new java.util.LinkedHashSet<>();
      for (JSONObject side : new JSONObject[] {a, b})
        for (String part : new String[] {"entries", "removed"}) {
          JSONObject o = side.optJSONObject(part);
          if (o == null) continue;
          java.util.Iterator<String> it = o.keys();
          while (it.hasNext()) keys.add(it.next());
        }
      try {
        for (String key : keys) {
          JSONObject x = part(a, "entries").optJSONObject(key), y = part(b, "entries").optJSONObject(key);
          JSONObject entry = x == null ? y : y == null ? x : y.optLong("at") > x.optLong("at") ? y : x;
          long gone = Math.max(part(a, "removed").optLong(key), part(b, "removed").optLong(key));
          if (entry != null && entry.optLong("at") > gone) entries.put(key, entry);
          else if (gone > 0 && now - gone < REMOVED_DAYS * 86400000L) removed.put(key, gone);
        }
        java.util.Set<String> titles = new java.util.HashSet<>();
        for (JSONObject entry : list(entries)) {
          String title = entry.optString("section") + "/" + entry.optString("item");
          if (titles.contains(title) || titles.size() >= LIMIT) entries.remove(entry.optString("key"));
          else titles.add(title);
        }
        List<String> names = new ArrayList<>();
        java.util.Iterator<String> it = removed.keys();
        while (it.hasNext()) names.add(it.next());
        final JSONObject all = removed;
        Collections.sort(names, (p, q) -> Long.compare(all.optLong(q), all.optLong(p)));
        for (int i = REMOVED_LIMIT; i < names.size(); i++) removed.remove(names.get(i));
        return new JSONObject().put("entries", entries).put("removed", removed);
      } catch (JSONException impossible) {
        throw new IllegalStateException(impossible);
      }
    }

    static boolean knownSection(String key) {
      for (String[] s : SECTIONS) if (s[0].equals(key)) return true;
      return false;
    }

    private static JSONObject part(JSONObject side, String name) {
      JSONObject o = side.optJSONObject(name);
      return o == null ? new JSONObject() : o;
    }
  }

  static final int CREDITS_DEFAULT = 30;
  static final String LULU_ENDPOINT = "https://calamarmenciano.com/calamar-lulu.php";
  /** Player pages of catalog channels read by the hosting (calamar-player.php), as the web plays them. */
  static final String PLAYER_ENDPOINT = "https://calamarmenciano.com/calamar-player.php";

  static String playerRelay(String page) {
    try {
      return PLAYER_ENDPOINT + "?page=" + java.net.URLEncoder.encode(page.trim(), "UTF-8").replace("+", "%20") + "&hls=1";
    } catch (java.io.UnsupportedEncodingException impossible) {
      throw new IllegalStateException(impossible);
    }
  }


  /**
   * {intro start, intro end, credits length, credits start, credits typed} in seconds for an episode of that
   * season: the season's own times, else the series' (start -1 without an intro, credits start -1 until
   * TheIntroDB gives it, credits typed 0 when the default is used). As skipMarks() in web/library.js.
   */
  static int[] skipMarks(JSONObject skip, int season) {
    JSONObject seasons = skip.optJSONObject("seasons");
    JSONObject own = seasons == null ? null : seasons.optJSONObject(String.valueOf(season));
    JSONArray intro = own != null && own.has("intro") ? own.optJSONArray("intro") : skip.optJSONArray("intro");
    double credits = own != null && own.has("credits") ? own.optDouble("credits", 0) : skip.optDouble("credits", 0);
    int start = -1, end = -1;
    if (intro != null && intro.length() == 2 && intro.optDouble(0, -1) >= 0 && intro.optDouble(1, -1) > intro.optDouble(0, -1)) {
      start = (int) intro.optDouble(0);
      end = (int) intro.optDouble(1);
    }
    return new int[] {start, end, credits > 0 ? (int) credits : CREDITS_DEFAULT, -1, credits > 0 ? (int) credits : 0};
  }

  static final String INTRODB_API = "https://api.theintrodb.org/v4/media";

  /** TheIntroDB's answer as {intro start, intro end, credits start} in seconds (-1 for what it lacks). */
  static int[] introDbMarks(JSONObject data) {
    JSONObject intro = firstSegment(data.optJSONArray("intro")), credits = firstSegment(data.optJSONArray("credits"));
    long start = intro == null ? -1 : intro.optLong("start_ms", -1), end = intro == null || intro.isNull("end_ms") ? -1 : intro.optLong("end_ms", -1);
    long creditsAt = credits == null ? -1 : credits.optLong("start_ms", -1);
    boolean hasIntro = start >= 0 && end > start;
    return new int[] {hasIntro ? (int) (start / 1000) : -1, hasIntro ? (int) (end / 1000) : -1, creditsAt > 0 ? (int) (creditsAt / 1000) : -1};
  }

  private static JSONObject firstSegment(JSONArray list) {
    if (list == null) return null;
    for (int i = 0; i < list.length(); i++) {
      JSONObject s = list.optJSONObject(i);
      if (s != null && s.has("start_ms") && !s.isNull("start_ms")) return s;
    }
    return null;
  }

  /** Which button shows at position t (ms): 1 «Saltar intro», 2 «Siguiente capítulo», 0 none. As skipButton(). */
  static int skipButton(int[] marks, long t, long duration, boolean hasNext) {
    if (marks == null || t < 0) return 0;
    if (marks[0] >= 0 && t >= marks[0] * 1000L && t < marks[1] * 1000L - 1000) return 1;
    long left = duration - t;
    if (!hasNext || duration <= 0 || left <= 500) return 0;
    // Where TheIntroDB says the credits start; otherwise the last seconds set for the series (30 by default).
    if (marks.length > 3 && marks[3] > 0 && marks[3] * 1000L < duration - 5000) return t >= marks[3] * 1000L ? 2 : 0;
    return duration > marks[2] * 2000L && left <= marks[2] * 1000L ? 2 : 0;
  }

  /** Only https LuluStream videos, Drive files or Calamar hosting files are played; the list cannot point the player elsewhere. */
  static final class Media {
    private Media() {}

    /** The LuluStream player page (https://luluvido.com/e/CODE: LuluStream's site since lulustream.com went down) of a LuluStream link, or null. */
    static String embed(String address) {
      try {
        java.net.URI u = java.net.URI.create(address.trim());
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(u.getScheme()) || u.getUserInfo() != null
            || !host.matches("(?:www\\.)?(?:lulustream|luluvdoo?|luluvido|luluvid|lulu)\\.(?:com|st|to|net|org|io|live|pw)")) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^/(?:e/|d/|v/)?([A-Za-z0-9]{8,20})(?:\\.html)?/?$").matcher(u.getPath() == null ? "" : u.getPath());
        return m.matches() && !m.group(1).equals("api") ? "https://luluvido.com/e/" + m.group(1) : null;
      } catch (Exception e) {
        return null;
      }
    }

    /**
     * The same video through the hosting (calamar-lulu.php), as the web plays it: used when LuluStream
     * does not give this device its player page. Null when the link is not LuluStream.
     */
    static String hosting(String address) {
      String embed = embed(address);
      return embed == null ? null : LULU_ENDPOINT + "?code=" + embed.substring(embed.lastIndexOf('/') + 1) + "&hls=1";
    }

    /** AnonMP4's embed page (https://anonmp4.art/embed/CODE) of an AnonMP4 link (/v/, /e/ or /embed/), or null. */
    static String anonmp4(String address) {
      try {
        java.net.URI u = java.net.URI.create(address.trim());
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("/(?:v|e|embed)/([A-Za-z0-9]{8,24})/?").matcher(u.getPath() == null ? "" : u.getPath());
        return "https".equalsIgnoreCase(u.getScheme()) && u.getUserInfo() == null && host.matches("(?:www\\.)?anonmp4\\.[a-z]{2,10}") && m.matches()
            ? "https://" + host + "/embed/" + m.group(1) : null;
      } catch (Exception e) {
        return null;
      }
    }

    static boolean allowed(String address) {
      if (embed(address) != null || anonmp4(address) != null) return true;
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
