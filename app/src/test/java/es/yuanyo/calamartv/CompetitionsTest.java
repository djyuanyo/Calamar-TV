package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.*;
import org.json.*;
import org.junit.Test;

/** Imported matches, as tools/competitions.test.mjs checks them on the web. */
public class CompetitionsTest {
  private JSONObject catalog() throws Exception {
    return new JSONObject("{\"channels\":[{\"id\":\"dazn\",\"name\":\"DAZN\",\"streams\":[\"https://example.com/dazn.m3u8\"]}],\"featured\":[],\"hidden\":[],\"events\":[],"
        + "\"leagues\":[{\"id\":\"espn-esp.1\",\"name\":\"LaLiga\",\"espn\":\"esp.1\",\"season\":\"2026/2027\",\"background\":\"https://example.com/fondo.jpg\"}],"
        + "\"teams\":[{\"id\":\"rm\",\"name\":\"Real Madrid\",\"logo\":\"https://example.com/rm.png\"},{\"id\":\"fcb\",\"name\":\"Barcelona\",\"logo\":\"https://example.com/fcb.png\"},"
        + "{\"id\":\"atm\",\"name\":\"Atlético Madrid\"},{\"id\":\"sev\",\"name\":\"Sevilla\"}],"
        + "\"fixtures\":[{\"id\":\"partido-301\",\"leagueId\":\"espn-esp.1\",\"homeTeamId\":\"rm\",\"awayTeamId\":\"fcb\",\"startAt\":\"2026-10-24T14:00:00.000Z\",\"round\":\"Jornada 2\",\"matchId\":\"301\"},"
        + "{\"id\":\"partido-302\",\"leagueId\":\"espn-esp.1\",\"homeTeamId\":\"atm\",\"awayTeamId\":\"sev\",\"startAt\":\"2026-10-25T20:00:00.000Z\",\"matchId\":\"302\",\"channelId\":\"dazn\"},"
        + "{\"id\":\"partido-303\",\"leagueId\":\"espn-esp.1\",\"homeTeamId\":\"sev\",\"awayTeamId\":\"rm\",\"startAt\":\"2026-10-26T19:00:00.000Z\",\"matchId\":\"303\"},"
        + "{\"id\":\"partido-304\",\"leagueId\":\"espn-esp.1\",\"homeTeamId\":\"fcb\",\"awayTeamId\":\"atm\",\"startAt\":\"2026-10-31T19:00:00.000Z\",\"matchId\":\"304\"}]}");
  }
  private static long at(String iso) { return SportsCatalog.instant(iso); }
  private static List<String> ids(List<Catalog.Channel> list) { List<String> out = new ArrayList<>(); for (Catalog.Channel c : list) out.add(c.matchId); return out; }

  @Test public void importedMatchesAreValidAndNamedAfterTheirTeams() throws Exception {
    JSONObject data = catalog();
    SharedCatalog.validate(data);
    JSONObject event = Competitions.find(data, "partido-301");
    assertEquals("Real Madrid vs Barcelona", event.getString("name"));
    assertEquals("https://www.google.com/search?q=Real%20Madrid%20vs%20Barcelona", event.getString("matchUrl"));
    assertEquals("2026/2027", event.getString("season"));
  }

  @Test public void viewersSeeTheWeekOfTheNextMatch() throws Exception {
    JSONObject data = catalog();
    List<Catalog.Channel> channels = Catalog.merge(null, data);
    assertEquals(Arrays.asList("301", "302"), ids(Catalog.events(channels, data, at("2026-10-21T10:00:00Z"), false)));
    assertEquals(Arrays.asList("302"), ids(Catalog.events(channels, data, at("2026-10-25T21:00:00Z"), false)));
    assertEquals(Arrays.asList("303", "304"), ids(Catalog.events(channels, data, at("2026-10-26T00:30:00Z"), false)));
    assertEquals(4, Catalog.events(channels, data, at("2026-10-21T10:00:00Z"), true).size());
    assertEquals("2026-10-19", Competitions.week(at("2026-10-25T22:30:00Z")));
    assertEquals("2026-10-26", Competitions.week(at("2026-10-25T23:30:00Z")));
  }

  @Test public void matchesWithoutChannelArePendingWithLeagueArt() throws Exception {
    JSONObject data = catalog();
    List<Catalog.Channel> shown = Catalog.events(Catalog.merge(null, data), data, at("2026-10-21T10:00:00Z"), false);
    Catalog.Channel pending = shown.get(0), playable = shown.get(1);
    assertTrue(pending.pending); assertFalse(pending.playable());
    assertTrue(pending.meta.endsWith("Canal por confirmar"));
    assertEquals("https://example.com/fondo.jpg", pending.background);
    assertEquals("https://example.com/rm.png", pending.homeLogo);
    assertEquals("https://example.com/fcb.png", pending.awayLogo);
    assertFalse(playable.pending); assertTrue(playable.playable()); assertEquals("dazn", playable.channelId);
  }

  @Test public void importedMatchesNeverChangeAnEventLink() throws Exception {
    JSONObject data = catalog();
    data.getJSONArray("events").put(new JSONObject("{\"id\":\"manual\",\"name\":\"Real Madrid vs Barcelona\",\"cover\":\"https://example.com/c.jpg\",\"channelId\":\"dazn\",\"startAt\":\"2026-12-01T19:00:00Z\"}"));
    Map<String, String> slugs = SportsCatalog.slugs(data);
    assertEquals("real-madrid-vs-barcelona", slugs.get("manual"));
    assertEquals("real-madrid-vs-barcelona-2", slugs.get("partido-301"));
  }

  @Test public void brokenImportedMatchesAreRejected() throws Exception {
    for (String change : new String[] {"{\"channelId\":\"nope\"}", "{\"homeTeamId\":\"nope\"}", "{\"startAt\":\"mañana\"}", "{\"matchId\":\"\"}", "{\"cover\":\"http://x.example/c.jpg\"}", "{\"awayTeamId\":\"rm\"}"}) {
      JSONObject data = catalog(), fixture = data.getJSONArray("fixtures").getJSONObject(0), patch = new JSONObject(change);
      for (Iterator<String> keys = patch.keys(); keys.hasNext(); ) { String key = keys.next(); fixture.put(key, patch.get(key)); }
      try { SharedCatalog.validate(data); fail("Accepted " + change); } catch (JSONException expected) {}
    }
    JSONObject data = catalog();
    data.getJSONArray("leagues").getJSONObject(0).put("background", "ftp://x");
    try { SharedCatalog.validate(data); fail("Accepted background"); } catch (JSONException expected) {}
  }
}
