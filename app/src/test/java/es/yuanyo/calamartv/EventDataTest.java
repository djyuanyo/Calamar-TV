package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.io.*;
import org.json.*;
import org.junit.Test;

public class EventDataTest {
  private JSONArray events(String name) throws Exception {
    JSONObject own =
        new JSONObject()
            .put("source", "own")
            .put("name", name)
            .put("url", "https://bp.zicotv.cc/api/player/6");
    JSONObject external =
        new JSONObject().put("source", "manual").put("url", "https://example.org/player");
    JSONObject event =
        new JSONObject()
            .put("title", "Partido")
            .put("sport_category", "Soccer")
            .put("sources", new JSONArray().put(own).put(external));
    return new JSONArray().put(event).put(event);
  }

  @Test
  public void channelCatalogDeduplicatesOwnSources() throws Exception {
    JSONArray catalog = EventData.mergeChannels(new JSONArray(), events("Canal 6"), 10);
    assertEquals(1, catalog.length());
    assertEquals("Canal 6", catalog.getJSONObject(0).getJSONObject("source").getString("name"));
  }

  @Test
  public void emptyEventFeedKeepsPreviouslyDiscoveredChannels() throws Exception {
    JSONArray catalog = EventData.mergeChannels(new JSONArray(), events("Canal 6"), 10);
    JSONArray result = EventData.mergeChannels(catalog, new JSONArray(), 20);
    assertEquals(1, result.length());
    assertEquals(10, result.getJSONObject(0).getJSONObject("source").getLong("catalog_seen_at"));
  }

  @Test
  public void newFeedRefreshesChannelWithoutDuplicatingIt() throws Exception {
    JSONArray catalog = EventData.mergeChannels(new JSONArray(), events("Nombre anterior"), 10);
    JSONArray result = EventData.mergeChannels(catalog, events("Nombre nuevo"), 20);
    assertEquals(1, result.length());
    assertEquals("Nombre nuevo", result.getJSONObject(0).getJSONObject("source").getString("name"));
    assertEquals(20, result.getJSONObject(0).getJSONObject("source").getLong("catalog_seen_at"));
  }

  @Test
  public void cacheSurvivesACompleteSaveAndReload() throws Exception {
    File file = File.createTempFile("calamar-events", ".json");
    try {
      JSONObject content = new JSONObject().put("data", events("Canal 6")).put("updated_at", 123);
      EventData.save(file, content);
      JSONObject restored = EventData.decode(EventData.read(new FileInputStream(file)));
      assertEquals(2, restored.getJSONArray("data").length());
      assertEquals(123, restored.getLong("updated_at"));
    } finally {
      file.delete();
    }
  }

  @Test(expected = JSONException.class)
  public void rejectsHtmlInsteadOfOverwritingTheCache() throws Exception {
    EventData.decode("<html>Service unavailable</html>");
  }

  @Test(expected = JSONException.class)
  public void rejectsNonArrayEventPayload() throws Exception {
    EventData.decode("{\"data\":{}}");
  }
}
