package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.*;
import org.json.*;
import org.junit.Test;

public class LibraryTest {
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
    List<Library.Item> top = data.top();
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
    assertEquals("https://lulustream.com/e/abcd1234efgh", Library.Media.embed("https://www.luluvdo.com/d/abcd1234efgh.html"));
    assertEquals("https://lulustream.com/e/abcd1234efgh", Library.Media.embed("https://lulustream.com/e/abcd1234efgh"));
    assertNull(Library.Media.embed("https://lulustream.com/fld/h9vd4z179z"));
    assertEquals("https://lulustream.com/e/duj5ak4x5waa", Library.Media.embed("https://luluvido.com/d/duj5ak4x5waa"));
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
}
