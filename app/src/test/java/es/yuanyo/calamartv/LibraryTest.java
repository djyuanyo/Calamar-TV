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
    assertEquals("10x01", seasons.get(10).get(0).label());
    assertEquals("Los hombres de Paco · 10x01 · Vuelta a empezar", paco.episodeTitle(seasons.get(10).get(0)));
    assertEquals("2 temporadas · 3 capítulos", paco.facts());
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
}
