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
  @Test public void manualLinksCombineAndWorkWithoutChannel() throws Exception {
    JSONObject data = catalog(), event = data.getJSONArray("events").getJSONObject(0);
    event.put("streams", new JSONArray().put("https://example.com/one.m3u8").put("https://bp.zicotv.cc/events/98019").put("https://example.com/two.m3u8"));
    SharedCatalog.validate(data);
    Catalog.Channel card = Catalog.events(Catalog.merge(null, data), data).get(0);
    assertEquals(3, card.streams.size());
    assertEquals(3, AppSources.forAndroid(card.streams).size());
    event.put("channelId", "");
    SharedCatalog.validate(data);
    assertEquals(3, Catalog.events(Collections.emptyList(), data).get(0).streams.size());
    event.put("streams", new JSONArray().put("javascript:alert(1)"));
    try { SharedCatalog.validate(data); fail("Invalid link accepted"); } catch (JSONException expected) {}
  }
  @Test public void leaguePageIncludesOnlyLinkedMatchesOfCurrentMadridWeek() throws Exception {
    JSONObject data = catalog(), base = data.getJSONArray("events").getJSONObject(0);
    base.put("leagueId", "l");
    JSONArray entries = new JSONArray();
    String[] dates = {"2026-10-25T22:59:59Z", "2026-10-25T23:00:00Z", "2026-10-31T19:00:00Z", "2026-11-01T22:59:59Z", "2026-11-01T23:00:00Z", ""};
    for (int i = 0; i < dates.length; i++) entries.put(new JSONObject(base.toString()).put("id", "week-" + i).put("startAt", dates[i]));
    entries.getJSONObject(1).put("matchUrl", "https://www.google.com/search?q=Local+Visitante").put("matchId", "weekly-ended-native");
    entries.getJSONObject(2).put("channelId", "").put("streams", new JSONArray().put("https://example.com/manual.m3u8"));
    entries.put(new JSONObject(base.toString()).put("id", "no-link").put("channelId", "").put("startAt", dates[2]));
    data.put("events", entries);
    long now = SportsCatalog.instant("2026-10-30T12:00:00Z");
    MatchScores.Result ended = new MatchScores.Result("Final", "Local", "Visitante", "finished");
    ended.finishedAt = now - 3600000;
    MatchScores.remember("weekly-ended-native", ended, now);
    try {
      List<Catalog.Channel> shown = Catalog.leagueEvents(Catalog.merge(null, data), data, "l", now);
      List<String> ids = new ArrayList<>();
      for (Catalog.Channel match : shown) ids.add(match.id);
      assertEquals(Arrays.asList("week-1", "week-2", "week-3"), ids);
      shown = Catalog.leagueEvents(Catalog.merge(null, data), data, "l", SportsCatalog.instant("2026-11-01T23:00:00Z"));
      assertEquals(1, shown.size()); assertEquals("week-4", shown.get(0).id);
    } finally { MatchScores.remember("weekly-ended-native", new MatchScores.Result("", "", "", "scheduled"), now); }
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

  @Test public void liveRowHasOnlyTodaysEventsWithVideoInOrder() throws Exception {
    JSONObject data = new JSONObject("{\"channels\":[{\"id\":\"sports\",\"name\":\"Deportes\",\"streams\":[\"https://example.com/one.m3u8\"]}],\"featured\":[],\"hidden\":[],\"events\":["
        + "{\"id\":\"late\",\"name\":\"Tarde\",\"channelId\":\"sports\",\"startAt\":\"2026-10-27T21:00:00.000Z\"},"
        + "{\"id\":\"early\",\"name\":\"Pronto\",\"channelId\":\"sports\",\"startAt\":\"2026-10-27T18:00:00.000Z\"},"
        + "{\"id\":\"tomorrow\",\"name\":\"Mañana\",\"channelId\":\"sports\",\"startAt\":\"2026-10-28T19:00:00.000Z\"}]}");
    long now = SportsCatalog.instant("2026-10-27T20:30:00Z");
    List<Catalog.Channel> live = Catalog.liveEvents(Catalog.events(Catalog.merge(null, data), data, now, false), now);
    assertEquals(2, live.size());
    assertEquals("early", live.get(0).id);
    assertEquals("late", live.get(1).id);
  }

  @Test public void leagueRowsFollowTheAdminOrder() throws Exception {
    JSONObject data = new JSONObject("{\"channels\":[{\"id\":\"sports\",\"name\":\"Deportes\",\"streams\":[\"https://example.com/one.m3u8\"]}],\"featured\":[],\"hidden\":[],"
        + "\"leagues\":[{\"id\":\"a\",\"name\":\"A\"},{\"id\":\"b\",\"name\":\"B\"},{\"id\":\"c\",\"name\":\"C\"}],\"leagueOrder\":[\"c\",\"a\"],\"events\":["
        + "{\"id\":\"1\",\"name\":\"Uno\",\"channelId\":\"sports\",\"leagueId\":\"a\",\"startAt\":\"2026-10-27T18:00:00.000Z\"},"
        + "{\"id\":\"2\",\"name\":\"Dos\",\"channelId\":\"sports\",\"leagueId\":\"b\",\"startAt\":\"2026-10-27T19:00:00.000Z\"},"
        + "{\"id\":\"3\",\"name\":\"Tres\",\"channelId\":\"sports\",\"leagueId\":\"c\",\"startAt\":\"2026-10-27T20:00:00.000Z\"}]}");
    long now = SportsCatalog.instant("2026-10-27T17:00:00Z");
    List<Catalog.EventRow> rows = Catalog.eventRows(Catalog.events(Catalog.merge(null, data), data, now, false), data);
    assertEquals("C", rows.get(0).name);
    assertEquals("A", rows.get(1).name);
    assertEquals("B", rows.get(2).name);
  }
}
