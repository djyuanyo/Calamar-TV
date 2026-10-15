package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.util.*;
import org.json.*;
import org.junit.Test;

public class CatalogTest {
  private JSONObject channel(String id, String group, String... streams) throws Exception {
    return new JSONObject()
        .put("id", id)
        .put("name", id.toUpperCase(Locale.ROOT))
        .put("group", group)
        .put("web", "https://example.com/" + id)
        .put("streams", new JSONArray(Arrays.asList(streams)));
  }

  private JSONObject tdt() throws Exception {
    return new JSONObject()
        .put(
            "channels",
            new JSONArray()
                .put(channel("la-1", "Generalistas", "https://example.com/la1.m3u8"))
                .put(channel("cuatro", "Generalistas"))
                .put(channel("tele", "Deportes", "https://example.com/tele.m3u8"))
                .put(channel("local", "Autonómicos", "https://example.com/local.m3u8")));
  }

  @Test
  public void ownChannelsComeFirstAndHiddenTdtChannelsAreRemoved() throws Exception {
    JSONObject custom =
        new JSONObject()
            .put("hidden", new JSONArray().put("tele"))
            .put(
                "channels",
                new JSONArray()
                    .put(channel("mio", "", "http://example.com:8080/live/1.ts"))
                    .put(channel("roto", "", "ftp://example.com/x")));
    List<Catalog.Channel> all = Catalog.merge(tdt(), custom);
    assertEquals("mio", all.get(0).id);
    assertEquals(Catalog.OWN_GROUP, all.get(0).group);
    assertTrue(all.get(0).own);
    List<String> ids = new ArrayList<>();
    for (Catalog.Channel c : all) ids.add(c.id);
    assertEquals(Arrays.asList("mio", "la-1", "cuatro", "local"), ids);
  }

  @Test
  public void webOnlyChannelsStayButAreNotPlayable() throws Exception {
    Catalog.Channel cuatro = Catalog.merge(tdt(), null).get(1);
    assertEquals("cuatro", cuatro.id);
    assertFalse(cuatro.playable());
    assertEquals("https://example.com/cuatro", cuatro.web);
  }

  @Test
  public void featuredFollowsAdminOrderAndSkipsUnplayable() throws Exception {
    JSONObject custom = new JSONObject().put("featured", new JSONArray().put("tele").put("cuatro"));
    List<Catalog.Channel> featured = Catalog.featured(Catalog.merge(tdt(), custom), custom, 3);
    assertEquals("tele", featured.get(0).id);
    assertEquals("la-1", featured.get(1).id);
    assertEquals("local", featured.get(2).id);
  }

  @Test
  public void groupsUseFixedOrderWithPlayableFirst() throws Exception {
    LinkedHashMap<String, List<Catalog.Channel>> groups =
        Catalog.groups(Catalog.merge(tdt(), new JSONObject()));
    assertEquals(
        Arrays.asList("Generalistas", "Deportes", "Autonómicos"),
        new ArrayList<>(groups.keySet()));
    assertEquals("la-1", groups.get("Generalistas").get(0).id);
  }

  @Test
  public void generatedCatalogParsesWithPlayableChannels() throws Exception {
    java.io.File file = new java.io.File("../data/tdt.json");
    if (!file.isFile()) file = new java.io.File("data/tdt.json");
    JSONObject data = new JSONObject(Io.read(new java.io.FileInputStream(file)));
    int playable = 0;
    for (Catalog.Channel c : Catalog.merge(data, null)) if (c.playable()) playable++;
    assertTrue("canales reproducibles: " + playable, playable >= 40);
  }
}
