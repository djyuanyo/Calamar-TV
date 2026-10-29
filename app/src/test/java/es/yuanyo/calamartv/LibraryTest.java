package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.*;
import org.json.*;
import org.junit.Test;

public class LibraryTest {
  @Test public void manualTrailerOverridesAndEmptyUsesImage() throws Exception {
    JSONObject title = new JSONObject().put("tmdb", new JSONObject().put("trailer", "abcdefghijk"));
    assertEquals("abcdefghijk", new Library.Item(title).trailer);
    title.put("trailerUrl", "https://youtu.be/12345678901?si=test");
    assertEquals("12345678901", new Library.Item(title).trailer);
    title.put("trailerUrl", "");
    assertEquals("", new Library.Item(title).trailer);
    assertEquals("", Library.youtubeTrailer("https://youtube.com.evil.test/watch?v=abcdefghijk"));
  }

  private static final String JSON = "{\"sections\":{"
      + "\"movies\":[{\"id\":\"mavatar\",\"kind\":\"movie\",\"title\":\"Avatar\",\"year\":2009,\"url\":\"https://calamarmenciano.com/MENCIA%20MEDIA/PELICULAS/Avatar.mkv\","
      + "\"tmdb\":{\"title\":\"Avatar\",\"year\":2009,\"overview\":\"Pandora\",\"genres\":[\"Acción\"],\"cast\":[{\"name\":\"Sam Worthington\",\"character\":\"Jake\"}],\"rating\":7.6,\"votes\":32000,\"runtime\":162}},"
      + "{\"id\":\"mevil\",\"kind\":\"movie\",\"title\":\"Fuera\",\"url\":\"https://example.com/x.mp4\"}],"
      + "\"series\":[{\"id\":\"spaco\",\"kind\":\"tv\",\"title\":\"Los hombres de Paco\",\"episodes\":["
      + "{\"id\":\"e2\",\"season\":10,\"episode\":2,\"url\":\"https://calamarmenciano.com/S/2.mkv\"},"
      + "{\"id\":\"e1\",\"season\":10,\"episode\":1,\"name\":\"Vuelta a empezar\",\"url\":\"https://calamarmenciano.com/S/1.mkv\"},"
      + "{\"id\":\"e3\",\"season\":1,\"episode\":1,\"url\":\"https://calamarmenciano.com/S/0.mkv\"}]}]},"
      + "\"attribution\":\"TMDB\"}";

  @Test public void readsSectionsAndKeepsOnlyHostingFiles() throws Exception {
    Library.Data data = new Library.Data(new JSONObject(JSON));
    assertEquals(1, data.items("movies").size());
    Library.Item avatar = data.items("movies").get(0);
    assertEquals("2009 · 162 min · ★ 7,6 (32.000)", avatar.facts());
    assertEquals("Sam Worthington", avatar.cast.get(0)[0]);
    assertTrue(data.items("documentaries").isEmpty());
    assertEquals("TMDB", data.attribution);
  }

  @Test public void groupsEpisodesBySeasonInOrder() throws Exception {
    Library.Item paco = new Library.Data(new JSONObject(JSON)).items("series").get(0);
    Map<Integer, List<Library.Episode>> seasons = paco.seasons();
    assertEquals(Arrays.asList(1, 10), new ArrayList<>(seasons.keySet()));
    Library.Episode first = seasons.get(10).get(0);
    assertEquals("Capítulo 1", first.label());
    assertEquals("Temporada 10", first.seasonLabel());
    assertEquals("Vuelta a empezar", first.title());
    assertEquals("Capítulo 2", paco.episode("e2").title());
    assertEquals("Los hombres de Paco · T10 · Vuelta a empezar", paco.episodeTitle(first));
    assertEquals("2 temporadas · 3 capítulos", paco.facts());
    assertEquals("e1", paco.next(seasons.get(1).get(0)).id);
    assertEquals("e2", paco.next(first).id);
    assertNull(paco.next(paco.episode("e2")));
    JSONObject entry = paco.entry("series", first);
    assertEquals("Temporada 10 · Vuelta a empezar", entry.getString("sub"));
    assertEquals("https://calamarmenciano.com/S/1.mkv", entry.getString("url"));
  }

  @Test public void progressKeepsOneEntryPerSeriesAndDropsWhatWasWatched() throws Exception {
    Library.Item paco = new Library.Data(new JSONObject(JSON)).items("series").get(0);
    JSONObject one = paco.entry("series", paco.episode("e1")), two = paco.entry("series", paco.episode("e2"));
    JSONObject store = Library.Progress.record(new JSONObject(), one, 5000, 1500000, 1);
    assertEquals(0, store.length());
    store = Library.Progress.record(store, one, 600000, 1500000, 2);
    assertEquals(600000, store.getJSONObject("e1").getLong("position"));
    store = Library.Progress.record(store, two, 60000, 1500000, 3);
    assertFalse(store.has("e1"));
    assertTrue(store.has("e2"));
    assertFalse(Library.Progress.finished(50000, 60000));
    assertEquals(0, Library.Progress.record(store, two, 1450000, 1500000, 4).length());
    assertEquals(0, Library.Progress.remove(store, "e2").length());
    for (int i = 0; i < Library.Progress.LIMIT + 3; i++)
      store = Library.Progress.record(store, new JSONObject().put("key", "m" + i).put("section", "movies").put("item", "m" + i), 100000, 3000000, 10 + i);
    List<JSONObject> list = Library.Progress.list(store);
    assertEquals(Library.Progress.LIMIT, list.size());
    assertEquals("m" + (Library.Progress.LIMIT + 2), list.get(0).getString("key"));
    assertEquals("1:02:05", Library.clock(3725000));
    assertEquals("1:15", Library.clock(75000));
  }

  @Test public void progressFromTheWebAndTheAppJoinsByTheLatestChange() throws Exception {
    long now = 1800000000000L;
    JSONObject app = new JSONObject().put("e1", new JSONObject().put("key", "e1").put("section", "series").put("item", "paco").put("episode", "e1")
        .put("name", "Paco").put("url", "https://calamarmenciano.com/S/1.mkv").put("intro_start", 5).put("position", 600000).put("duration", 1500000).put("at", now - 9000));
    JSONObject shared = Library.Progress.toCloud(app, new JSONObject());
    assertEquals(600, shared.getJSONObject("entries").getJSONObject("e1").getLong("position"));
    assertFalse(shared.getJSONObject("entries").getJSONObject("e1").has("url"));
    // The web watched the next episode later and removed a film: both win over this device.
    JSONObject web = new JSONObject("{\"entries\":{\"e2\":{\"key\":\"e2\",\"section\":\"series\",\"item\":\"paco\",\"episode\":\"e2\",\"name\":\"Paco\",\"position\":30,\"duration\":1500,\"at\":"
        + (now - 1000) + "}},\"removed\":{\"f1\":" + (now - 500) + "}}");
    app.put("f1", new JSONObject().put("key", "f1").put("section", "movies").put("item", "film").put("position", 90000).put("at", now - 2000));
    JSONObject merged = Library.Progress.merge(Library.Progress.toCloud(app, new JSONObject()), web, now);
    JSONObject store = Library.Progress.fromCloud(merged, app);
    assertFalse(store.has("e1"));
    assertFalse(store.has("f1"));
    assertEquals(30000, store.getJSONObject("e2").getLong("position"));
    assertEquals(now - 500, merged.getJSONObject("removed").getLong("f1"));
    // Watching the same episode again here keeps what only the app stores (link, marks).
    JSONObject again = Library.Progress.fromCloud(Library.Progress.merge(shared, new JSONObject(), now), app);
    assertEquals("https://calamarmenciano.com/S/1.mkv", again.getJSONObject("e1").getString("url"));
    assertEquals(5, again.getJSONObject("e1").getInt("intro_start"));
    // Removed here: noted, and cleared when it is watched again later.
    JSONObject gone = Library.Progress.removals(app, new JSONObject(), new JSONObject(), now);
    assertEquals(now, gone.getLong("e1"));
    JSONObject back = new JSONObject().put("e1", new JSONObject(app.getJSONObject("e1").toString()).put("at", now + 5));
    assertFalse(Library.Progress.removals(new JSONObject(), back, gone, now + 5).has("e1"));
  }

  @Test public void featuredTitlesAndTheWeeklyTop() throws Exception {
    JSONArray movies = new JSONArray();
    for (int i = 1; i <= 12; i++)
      movies.put(new JSONObject().put("id", "m" + i).put("kind", "movie").put("url", "https://calamarmenciano.com/m" + i + ".mp4")
          .put("tmdb", new JSONObject().put("title", "Peli " + i)).put("trend", 13 - i).put("featured", i == 3 ? 200 : i == 7 ? 100 : 0));
    Library.Data data = new Library.Data(new JSONObject().put("sections", new JSONObject().put("movies", movies)));
    List<Library.Item> featured = data.featured();
    assertEquals(2, featured.size());
    assertEquals("m7", featured.get(0).id);
    assertEquals("m3", featured.get(1).id);
    assertTrue(data.top("series").isEmpty());
    List<Library.Item> top = data.top("movies");
    assertEquals(10, top.size());
    assertEquals("m12", top.get(0).id);
    assertEquals("movies", data.sectionOf(top.get(0)));
    assertEquals("m5", data.find("movies", "m5").id);
    assertNull(data.find("series", "m5"));
  }

  @Test public void visibilityIsAnOptionalBoolean() throws Exception {
    JSONObject catalog = new JSONObject("{\"channels\":[],\"featured\":[],\"hidden\":[]}");
    assertFalse(Library.visible(catalog));
    catalog.put("libraryVisible", true); SharedCatalog.validate(catalog);
    assertTrue(Library.visible(catalog));
    catalog.put("libraryVisible", "sí");
    try { SharedCatalog.validate(catalog); fail("Text accepted"); } catch (JSONException expected) {}
    assertEquals("series", Library.section("Series")); assertNull(Library.section("Canales"));
  }

  @Test public void googleDriveVideosArePlayableButNotOtherSites() {
    assertTrue(Library.Media.allowed("https://www.googleapis.com/drive/v3/files/1AbC_d-9?alt=media&key=AIzaX"));
    assertTrue(Library.Media.allowed("https://calamarmenciano.com/MENCIA%20MEDIA/a.mkv"));
    assertFalse(Library.Media.allowed("https://www.googleapis.com/youtube/v3/videos"));
    assertFalse(Library.Media.allowed("http://www.googleapis.com/drive/v3/files/1AbC"));
    assertFalse(Library.Media.allowed("https://example.com/drive/v3/files/1AbC"));
    assertTrue(Library.Media.allowed("https://lulustream.com/abcd1234efgh"));
    assertEquals("https://luluvido.com/e/abcd1234efgh", Library.Media.embed("https://www.luluvdo.com/d/abcd1234efgh.html"));
    assertEquals("https://luluvido.com/e/abcd1234efgh", Library.Media.embed("https://lulustream.com/e/abcd1234efgh"));
    assertNull(Library.Media.embed("https://lulustream.com/fld/h9vd4z179z"));
    assertEquals("https://luluvido.com/e/duj5ak4x5waa", Library.Media.embed("https://luluvido.com/d/duj5ak4x5waa"));
    assertEquals("https://calamarmenciano.com/calamar-lulu.php?code=bq4heljir3hb&hls=1", Library.Media.hosting("https://lulustream.com/bq4heljir3hb"));
    assertNull(Library.Media.hosting("https://example.com/video.mp4"));
    // Same address as playerPageRelay() on the web.
    assertEquals("https://calamarmenciano.com/calamar-player.php?page=https%3A%2F%2Fzicotv.cc%2Fapi%2Fplayer%2F1%3Fa%3D1%26b%3D2&hls=1", Library.playerRelay(" https://zicotv.cc/api/player/1?a=1&b=2 "));
    assertNull(Library.Media.embed("http://lulustream.com/abcd1234efgh"));
    assertNull(Library.Media.embed("https://lulustream.com.evil.com/abcd1234efgh"));
  }

  @Test public void skipIntroAndNextEpisode() throws Exception {
    JSONObject skip = new JSONObject("{\"intro\":[30,105],\"credits\":45,\"seasons\":{\"2\":{\"intro\":[10,70]}}}");
    assertArrayEquals(new int[] {30, 105, 45, -1, 45}, Library.skipMarks(skip, 1));
    assertArrayEquals(new int[] {10, 70, 45, -1, 45}, Library.skipMarks(skip, 2));
    assertArrayEquals(new int[] {-1, -1, 30, -1, 0}, Library.skipMarks(new JSONObject(), 1));
    int[] marks = Library.skipMarks(skip, 1);
    assertEquals(0, Library.skipButton(marks, 29000, 2400000, true));
    assertEquals(1, Library.skipButton(marks, 30000, 2400000, true));
    assertEquals(0, Library.skipButton(marks, 104500, 2400000, true));
    assertEquals(2, Library.skipButton(marks, 2356000, 2400000, true));
    assertEquals(0, Library.skipButton(marks, 2356000, 2400000, false));
    assertEquals(0, Library.skipButton(marks, 2356000, -1, true));
    Library.Item paco = new Library.Item(new JSONObject("{\"id\":\"s1\",\"kind\":\"tv\",\"title\":\"Paco\",\"skip\":{\"intro\":[30,90]},\"episodes\":["
        + "{\"id\":\"a\",\"season\":1,\"episode\":1,\"url\":\"https://lulustream.com/aaaaaaaaaaaa\"},{\"id\":\"b\",\"season\":1,\"episode\":2,\"url\":\"https://lulustream.com/bbbbbbbbbbbb\"}]}"));
    JSONObject first = paco.entry("series", paco.episodes.get(0)), last = paco.entry("series", paco.episodes.get(1));
    assertEquals(30, first.getInt("intro_start"));
    assertEquals(90, first.getInt("intro_end"));
    assertEquals(30, first.getInt("credits"));
    assertTrue(first.getBoolean("has_next"));
    assertFalse(last.getBoolean("has_next"));
    assertTrue(first.getBoolean("manual_intro"));
    assertFalse(first.getBoolean("manual_credits"));
    // TheIntroDB (Breaking Bad 1x01): intro 3:48–4:06, credits from 57:11; «Siguiente capítulo» from there.
    int[] found = Library.introDbMarks(new JSONObject("{\"tvdb_id\":81189,\"type\":\"tv\",\"season\":1,\"episode\":1,"
        + "\"intro\":[{\"start_ms\":228664,\"end_ms\":246143}],\"credits\":[{\"start_ms\":3431000,\"end_ms\":null}]}"));
    assertArrayEquals(new int[] {228, 246, 3431}, found);
    assertArrayEquals(new int[] {-1, -1, -1}, Library.introDbMarks(new JSONObject("{\"intro\":[],\"credits\":[]}")));
    int[] auto = {228, 246, 30, 3431, 0};
    assertEquals(0, Library.skipButton(auto, 3430000, 3480000, true));
    assertEquals(2, Library.skipButton(auto, 3431000, 3480000, true));
  }

  private static Library.Item film(String id, int year, String extra, String tmdb) throws Exception {
    return new Library.Item(new JSONObject("{\"id\":\"" + id + "\",\"kind\":\"movie\",\"url\":\"https://example.com/a.mp4\"" + extra
        + ",\"tmdb\":{\"title\":\"" + id + "\",\"year\":" + year + ",\"genres\":[\"Drama\"]" + tmdb + "}}"));
  }

  @Test public void filtersReleasesAndNewArrivalsLikeTheWeb() throws Exception {
    long now = SportsCatalog.instant("2026-10-28T12:00:00Z");
    Library.Item fresh = film("nueva", 2026, ",\"addedAt\":\"2026-10-20\"", ",\"providers\":[\"Netflix\"],\"released\":\"2026-09-01\",\"rating\":7");
    Library.Item oldAdded = film("vieja", 2019, ",\"addedAt\":\"2026-10-25\"", ",\"rating\":8");
    Library.Item release = film("estreno", 2026, ",\"addedAt\":\"2026-08-01\"", ",\"released\":\"2026-02-01\"");
    Library.Item classic = film("clasica", 1998, "", "");
    List<Library.Item> all = Arrays.asList(fresh, oldAdded, release, classic);
    assertTrue(Library.newArrival(fresh, now));
    assertFalse(Library.newArrival(oldAdded, now));
    assertFalse(Library.newArrival(release, now));
    assertEquals(Arrays.asList(fresh), Library.filter(all, "", 0, "", "nuevas", "", now));
    assertEquals(Arrays.asList(fresh, release), Library.filter(all, "", 0, "", "estrenos", "", now));
    assertEquals(Arrays.asList(fresh), Library.filter(all, "", 0, "Netflix", "", "", now));
    assertEquals(Arrays.asList(classic), Library.filter(all, "", 1998, "", "", "", now));
    assertEquals(Arrays.asList(oldAdded, fresh, release, classic), Library.filter(all, "", 0, "", "", "added", now));
  }

  private static Library.Item titled(String id, String genres, String countries, String providers, String extra) throws Exception {
    return new Library.Item(new JSONObject("{\"id\":\"" + id + "\",\"kind\":\"movie\",\"url\":\"https://example.com/a.mp4\"" + extra
        + ",\"tmdb\":{\"id\":" + id.length() + ",\"title\":\"" + id + "\",\"genres\":[" + genres + "],\"countries\":[" + countries + "],\"providers\":[" + providers + "]}}"));
  }

  @Test public void sectionPageRowsMatchTheWeb() throws Exception {
    long now = SportsCatalog.instant("2026-10-28T12:00:00Z");
    List<Library.Item> items = Arrays.asList(
        titled("torrente", "\"Comedia\"", "\"ES\"", "\"Netflix\"", ",\"trend\":2,\"addedAt\":\"2026-10-01\""),
        titled("weapons", "\"Terror\",\"Misterio\"", "\"US\"", "", ",\"trend\":1,\"year\":2026,\"addedAt\":\"2026-10-20\""),
        titled("kraven", "\"Acción\",\"Ciencia ficción\"", "\"US\"", "\"Netflix\"", ""),
        titled("ozark", "\"Western\"", "\"US\"", "\"Netflix\"", ""));
    List<String> titles = new ArrayList<>();
    Map<String, Library.Row> by = new HashMap<>();
    for (Library.Row row : Library.browseRows("movies", items, new HashSet<String>(), "Yuanyo", now)) { titles.add(row.title); by.put(row.key, row); }
    assertEquals(Arrays.asList("Películas españolas", "Recomendaciones de hoy para ti", "Las 2 películas más populares de la semana",
        "Películas de terror", "Novedades en Calamar TV", "Seguir viendo para Yuanyo", "Ciencia ficción y fantasía", "¿Quieres echarte unas risas?",
        "Acción a tope", "Misterios por resolver", "Películas de western"), titles);
    assertEquals("weapons", by.get("top").items.get(0).id);
    assertEquals("top", by.get("top").kind);
    assertEquals("big", by.get("new").kind);
    assertEquals(1, by.get("new").items.size());
    assertEquals("weapons", by.get("new").items.get(0).id);
  }

  @Test public void dailyPicksAndHalloweenMatchTheWeb() throws Exception {
    assertEquals(0.8042505686171353, Library.dailyLuck("2026-10-28", "mavatar"), 1e-12);
    assertEquals(0.7184240000788122, Library.dailyLuck("2026-10-29", "sñ"), 1e-12);
    assertFalse(Library.halloweenOn(SportsCatalog.instant("2026-09-30T12:00:00Z")));
    assertTrue(Library.halloweenOn(SportsCatalog.instant("2026-10-01T08:00:00Z")));
    assertTrue(Library.halloweenOn(SportsCatalog.instant("2026-11-02T22:30:00Z")));
    assertFalse(Library.halloweenOn(SportsCatalog.instant("2026-11-02T23:30:00Z")));
    Library.Data data = new Library.Data(new JSONObject("{\"sections\":{\"movies\":[{\"id\":\"m\",\"kind\":\"movie\",\"url\":\"https://calamarmenciano.com/M.mkv\",\"tmdb\":{\"title\":\"M\",\"genres\":[\"Terror\"]}},"
        + "{\"id\":\"n\",\"kind\":\"movie\",\"url\":\"https://calamarmenciano.com/N.mkv\",\"tmdb\":{\"title\":\"N\",\"genres\":[\"Drama\"]}}]}}"));
    List<Object[]> horror = Library.horror(data);
    assertEquals(1, horror.size());
    assertEquals("movies", horror.get(0)[0]);
  }

  private static Library.Item show(String id, String added, String... days) throws Exception {
    StringBuilder episodes = new StringBuilder();
    for (int i = 0; i < days.length; i++)
      episodes.append(i > 0 ? "," : "").append("{\"id\":\"").append(id).append(i).append("\",\"season\":1,\"episode\":").append(i + 1)
          .append(",\"url\":\"https://calamarmenciano.com/").append(id).append(i).append(".mkv\"").append(days[i].isEmpty() ? "" : ",\"aired\":\"" + days[i] + "\"").append("}");
    return new Library.Item(new JSONObject("{\"id\":\"" + id + "\",\"kind\":\"tv\",\"addedAt\":\"" + added + "\",\"episodes\":[" + episodes
        + "],\"tmdb\":{\"id\":9,\"title\":\"" + id + "\",\"year\":2019,\"providers\":[\"Netflix\"],\"logos\":{\"Netflix\":\"https://image.tmdb.org/t/p/w154/n.jpg\"}}}"));
  }

  @Test public void newEpisodesNewsSliderAndPlatformsMatchTheWeb() throws Exception {
    long now = SportsCatalog.instant("2026-10-28T12:00:00Z");
    Library.Item fresh = show("a", "2026-01-10", "2026-01-10", "2026-10-25");
    assertTrue(Library.newEpisode(fresh, now));
    assertEquals("Nuevo episodio", Library.posterLabel(fresh, now));
    assertFalse(Library.newEpisode(show("b", "2026-01-10", "2026-01-10", "2026-10-01"), now));
    assertFalse(Library.newEpisode(show("c", "2026-10-27", "2009-03-01", "2009-03-08"), now));
    assertFalse(Library.newEpisode(show("d", "2026-01-10", "", ""), now));
    Library.Item arrived = titled("m", "", "", "\"Disney Plus\"", ",\"year\":2026,\"addedAt\":\"2026-10-20\"");
    Library.Item top = titled("t", "", "", "\"Disney Plus\"", ",\"trend\":1");
    assertEquals(Arrays.asList(fresh, arrived), Library.freshTitles(Arrays.asList(arrived, fresh, top), now));
    assertEquals(Arrays.asList(fresh, arrived, top), Library.heroTitles(Arrays.asList(top, arrived, fresh), now, 8));
    List<String[]> platforms = Library.platforms(Arrays.asList(arrived, top, fresh));
    assertEquals("Disney Plus", platforms.get(0)[0]);
    assertEquals("2", platforms.get(0)[2]);
    assertEquals("https://image.tmdb.org/t/p/w154/n.jpg", platforms.get(1)[1]);
  }

  @Test public void platformSettingsFromTheAdminPageMatchTheWeb() throws Exception {
    Library.Item a = titled("a", "", "", "\"Netflix\",\"Max\",\"Filmin\"", "");
    Library.Item b = titled("b", "", "", "\"Netflix\",\"Max\"", "");
    JSONArray settings = new JSONArray("[{\"name\":\"Filmin\",\"logo\":\"https://mio/filmin.png\"},{\"name\":\"Max\",\"hidden\":true}]");
    List<String[]> out = Library.platforms(Arrays.asList(a, b), settings);
    assertEquals(2, out.size());
    assertEquals("Filmin", out.get(0)[0]);
    assertEquals("https://mio/filmin.png", out.get(0)[1]);
    assertEquals("Netflix", out.get(1)[0]);
  }

  @Test public void horrorRowHasTheHalloweenBanner() throws Exception {
    long now = SportsCatalog.instant("2026-10-28T12:00:00Z");
    for (Library.Row row : Library.browseRows("movies", Arrays.asList(titled("w", "\"Terror\"", "", "", "")), new HashSet<String>(), "", now))
      if (row.key.equals("terror")) { assertEquals("horror", row.kind); return; }
    fail("No horror row");
  }

  @Test public void titlePageDataMatchesTheWeb() throws Exception {
    Library.Item a = new Library.Item(new JSONObject("{\"id\":\"a\",\"kind\":\"movie\",\"url\":\"https://calamarmenciano.com/a.mkv\",\"tmdb\":{\"title\":\"A\",\"genres\":[\"Drama\",\"Crimen\"],\"trailer\":\"dQw4w9WgXcQ\",\"creators\":[\"Said Chamie\",\"Claudia Sánchez\"]}}"));
    Library.Item bad = new Library.Item(new JSONObject("{\"id\":\"x\",\"kind\":\"movie\",\"url\":\"https://calamarmenciano.com/x.mkv\",\"tmdb\":{\"title\":\"X\",\"trailer\":\"<script>\"}}"));
    assertEquals("dQw4w9WgXcQ", a.trailer);
    assertEquals("", bad.trailer);
    assertEquals(Arrays.asList("Said Chamie", "Claudia Sánchez"), a.creators);
    Library.Data data = new Library.Data(new JSONObject("{\"sections\":{\"movies\":["
        + "{\"id\":\"a\",\"kind\":\"movie\",\"url\":\"https://calamarmenciano.com/a.mkv\",\"tmdb\":{\"title\":\"A\",\"genres\":[\"Drama\",\"Crimen\"]}},"
        + "{\"id\":\"b\",\"kind\":\"movie\",\"url\":\"https://calamarmenciano.com/b.mkv\",\"tmdb\":{\"title\":\"B\",\"genres\":[\"Drama\",\"Crimen\"],\"rating\":5}},"
        + "{\"id\":\"c\",\"kind\":\"movie\",\"url\":\"https://calamarmenciano.com/c.mkv\",\"tmdb\":{\"title\":\"C\",\"genres\":[\"Drama\"],\"rating\":9}},"
        + "{\"id\":\"d\",\"kind\":\"movie\",\"url\":\"https://calamarmenciano.com/d.mkv\",\"tmdb\":{\"title\":\"D\",\"genres\":[\"Western\"]}}]}}"));
    List<String> similar = new ArrayList<>();
    for (Library.Item item : Library.similar(data, "movies", data.items("movies").get(0), 12)) similar.add(item.id);
    assertEquals(Arrays.asList("b", "c"), similar);
    Library.Item paco = new Library.Data(new JSONObject(JSON)).items("series").get(0);
    assertEquals("e3", Library.resumeEpisode(paco, new JSONObject()).id);
    assertEquals("e2", Library.resumeEpisode(paco, new JSONObject("{\"e1\":{\"at\":5},\"e2\":{\"at\":9}}")).id);
    assertEquals("documentales", Library.page("documentaries"));
  }

  @Test public void anonmp4LinksOpenItsEmbedPage() {
    assertEquals("https://anonmp4.art/embed/ESuKsItGgV4rMAE", Library.Media.anonmp4("https://anonmp4.art/v/ESuKsItGgV4rMAE"));
    assertNull(Library.Media.anonmp4("http://anonmp4.art/v/ESuKsItGgV4rMAE"));
    assertNull(Library.Media.anonmp4("https://anonmp4.art.evil.com/v/ESuKsItGgV4rMAE"));
    assertTrue(Library.Media.allowed("https://anonmp4.art/v/ESuKsItGgV4rMAE"));
  }

  @Test public void similarPutsTheSameSagaFirst() {
    assertEquals("torrente", Library.sagaName("Torrente 2: Misión en Marbella"));
    assertEquals("torrente", Library.sagaName("Torrente, el brazo tonto de la ley"));
    assertEquals("rocky", Library.sagaName("Rocky IV"));
    assertEquals(2, Library.titleRelation("Torrente 3: El protector", "Torrente 5: Operación Eurovegas"));
    assertEquals(1, Library.titleRelation("Harry Potter y la piedra filosofal", "Harry Potter y la cámara secreta"));
    assertEquals(0, Library.titleRelation("La vida es bella", "La vida de Brian"));
  }
}
