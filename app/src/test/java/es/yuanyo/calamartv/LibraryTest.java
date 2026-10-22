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
    assertNull(Library.Media.embed("http://lulustream.com/abcd1234efgh"));
    assertNull(Library.Media.embed("https://lulustream.com.evil.com/abcd1234efgh"));
  }
}
