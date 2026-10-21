package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.*;
import org.json.*;
import org.junit.Test;

public class CatalogEventsTest {
  private JSONObject catalog() throws Exception {
    return new JSONObject("{\"channels\":[{\"id\":\"sports\",\"name\":\"Deportes\",\"streams\":[\"https://example.com/one.m3u8\"]}],\"featured\":[],\"hidden\":[],\"events\":[{\"id\":\"match\",\"name\":\"Local vs visitante\",\"cover\":\"https://example.com/cover.jpg\",\"channelId\":\"sports\"}]}");
  }
  @Test public void eventUsesCurrentSelectedChannelAndFullCover() throws Exception {
    JSONObject data = catalog();
    SharedCatalog.validate(data);
    Catalog.Channel event = Catalog.events(Catalog.merge(null, data), data).get(0);
    assertEquals("match", event.id); assertEquals("sports", event.channelId); assertEquals("Local vs visitante", event.name);
    assertEquals("https://example.com/cover.jpg", event.cover); assertTrue(event.event);
    data.getJSONArray("channels").getJSONObject(0).put("streams", new JSONArray().put("https://example.com/two.m3u8"));
    assertEquals("https://example.com/two.m3u8", Catalog.events(Catalog.merge(null, data), data).get(0).streams.get(0));
    assertTrue(Catalog.events(Collections.emptyList(), data).isEmpty());
  }
  @Test public void legacyCatalogNeedsNoEvents() throws Exception {
    JSONObject data = catalog(); data.remove("events"); SharedCatalog.validate(data);
    assertTrue(Catalog.events(Catalog.merge(null, data), data).isEmpty());
  }
  @Test public void missingChannelAndUnsafeCoverAreRejected() throws Exception {
    JSONObject data = catalog(); data.getJSONArray("events").getJSONObject(0).put("channelId", "missing");
    try { SharedCatalog.validate(data); fail("Missing channel accepted"); } catch (JSONException expected) {}
    assertTrue(SharedCatalog.validCover("data:image/jpeg;base64,/9j/AAAA"));
    assertFalse(SharedCatalog.validCover("http://example.com/x.jpg"));
    assertFalse(SharedCatalog.validCover("https://user:pass@example.com/x.jpg"));
    assertFalse(SharedCatalog.validCover("data:image/svg+xml;base64,AAAA"));
  }
}
