package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import org.json.*;
import org.junit.Test;

public class MatchCenterTest {
  static JSONObject summary() throws Exception {
    return new JSONObject("{\"header\":{\"id\":\"1\",\"league\":{\"name\":\"UEFA Champions League\"},\"competitions\":[{\"id\":\"1\",\"date\":\"2026-10-21T19:00Z\","
      + "\"status\":{\"displayClock\":\"67'\",\"type\":{\"state\":\"in\",\"name\":\"STATUS_SECOND_HALF\",\"completed\":false}},"
      + "\"competitors\":[{\"homeAway\":\"home\",\"score\":\"1\",\"team\":{\"id\":\"86\",\"displayName\":\"Real Madrid\",\"abbreviation\":\"RMA\",\"logos\":[{\"href\":\"https://a.espncdn.com/rma.png\"}]}},"
      + "{\"homeAway\":\"away\",\"score\":\"1\",\"team\":{\"id\":\"111\",\"displayName\":\"Juventus\",\"abbreviation\":\"JUV\",\"logo\":\"http://insecure/juv.png\"}}]}]},"
      + "\"keyEvents\":[{\"type\":{\"type\":\"goal---header\",\"text\":\"Goal - Header\"},\"scoringPlay\":true,\"clock\":{\"displayValue\":\"23'\"},\"team\":{\"id\":\"86\"},\"participants\":[{\"athlete\":{\"displayName\":\"Vinícius Júnior\"}}]},"
      + "{\"type\":{\"type\":\"penalty---scored\",\"text\":\"Penalty - Scored\"},\"scoringPlay\":true,\"clock\":{\"displayValue\":\"55'\"},\"team\":{\"id\":\"111\"},\"participants\":[{\"athlete\":{\"displayName\":\"Dušan Vlahović\"}}]},"
      + "{\"type\":{\"type\":\"substitution\",\"text\":\"Substitution\"},\"clock\":{\"displayValue\":\"60'\"},\"team\":{\"id\":\"111\"},\"participants\":[{\"athlete\":{\"displayName\":\"Milik\"}},{\"athlete\":{\"displayName\":\"Vlahović\"}}]},"
      + "{\"type\":{\"type\":\"kickoff\",\"text\":\"Kickoff\"},\"clock\":{\"displayValue\":\"0'\"}}],"
      + "\"boxscore\":{\"teams\":[{\"team\":{\"id\":\"111\"},\"statistics\":[{\"name\":\"possessionPct\",\"displayValue\":\"35.5\"},{\"name\":\"foulsCommitted\",\"displayValue\":\"14\"}]},"
      + "{\"team\":{\"id\":\"86\"},\"statistics\":[{\"name\":\"possessionPct\",\"displayValue\":\"64.5\"},{\"name\":\"foulsCommitted\",\"displayValue\":\"9\"}]}]},"
      + "\"rosters\":[{\"homeAway\":\"away\",\"formation\":\"3-5-2\",\"roster\":[{\"starter\":false,\"jersey\":\"9\",\"athlete\":{\"displayName\":\"Milik\"},\"subbedIn\":true},"
      + "{\"starter\":true,\"jersey\":\"1\",\"athlete\":{\"displayName\":\"Di Gregorio\"},\"position\":{\"abbreviation\":\"G\"},\"formationPlace\":\"1\"}]}],"
      + "\"gameInfo\":{\"venue\":{\"fullName\":\"Santiago Bernabéu\",\"address\":{\"city\":\"Madrid\"}},\"attendance\":78000,\"officials\":[{\"fullName\":\"Szymon Marciniak\",\"position\":{\"name\":\"Referee\"}}]}}");
  }

  @Test public void readsScoreEventsStatisticsLineupsAndInformation() throws Exception {
    MatchCenter.Model m = MatchCenter.parse(summary());
    assertEquals("1 – 1 · En juego · 67′", m.status);
    assertEquals("https://a.espncdn.com/rma.png", m.home.logo);
    assertEquals("", m.away.logo);
    assertEquals(3, m.events.size());
    assertEquals("goal", m.events.get(0).kind); assertEquals("home", m.events.get(0).side);
    assertEquals("penalty", m.events.get(1).kind); assertEquals("away", m.events.get(1).side);
    assertEquals("sub", m.events.get(2).kind); assertEquals("Vlahović", m.events.get(2).other);
    assertEquals(2, m.stats.size());
    assertEquals("Posesión", m.stats.get(0).label); assertEquals("64.5%", m.stats.get(0).home); assertEquals("35.5%", m.stats.get(0).away);
    assertEquals("9", m.stats.get(1).home); assertEquals("14", m.stats.get(1).away);
    assertEquals(1, m.lineups.size());
    assertEquals("Di Gregorio", m.lineups.get(0).starters.get(0).name);
    assertTrue(m.lineups.get(0).subs.get(0).in);
    assertEquals("Santiago Bernabéu", m.venue); assertEquals("Madrid", m.city); assertEquals(78000, m.attendance);
    assertEquals("Szymon Marciniak", m.referee); assertEquals("UEFA Champions League", m.league);
  }

  @Test public void aMatchNotStartedStillShowsWhoPlays() throws Exception {
    MatchCenter.Model m = MatchCenter.parse(new JSONObject("{\"header\":{\"competitions\":[{\"status\":{\"type\":{\"state\":\"pre\",\"name\":\"STATUS_SCHEDULED\"}},"
      + "\"competitors\":[{\"homeAway\":\"home\",\"team\":{\"displayName\":\"A\"}},{\"homeAway\":\"away\",\"team\":{\"displayName\":\"B\"}}]}]}}"));
    assertEquals("A", m.home.name); assertEquals("B", m.away.name); assertEquals("", m.home.score);
    assertEquals("scheduled", m.state); assertTrue(m.events.isEmpty()); assertTrue(m.stats.isEmpty()); assertTrue(m.lineups.isEmpty());
  }

  @Test public void formMeetingsAndTheEventsOwnData() throws Exception {
    JSONObject data = summary();
    data.getJSONObject("boxscore").put("form", new JSONArray("[{\"team\":{\"id\":\"86\"},\"events\":[{\"gameResult\":\"W\",\"score\":\"3-0\"},{\"gameResult\":\"L\"}]}]"));
    data.put("headToHeadGames", new JSONArray("[{\"team\":{\"id\":\"86\",\"displayName\":\"Real Madrid\"},\"events\":[{\"id\":\"a\",\"gameDate\":\"2024-02-01T20:00Z\",\"homeTeamId\":\"86\",\"score\":\"2-1\",\"opponent\":{\"displayName\":\"Juventus\"}},"
      + "{\"id\":\"b\",\"gameDate\":\"2025-02-01T20:00Z\",\"homeTeamId\":\"111\",\"atVs\":\"@\",\"score\":\"0-0\",\"opponent\":{\"displayName\":\"Juventus\"}}]}]"));
    MatchCenter.Model m = MatchCenter.parse(data);
    assertEquals(2, m.homeForm.size()); assertEquals("W", m.homeForm.get(0).result);
    assertEquals("Juventus", m.h2h.get(0).home); assertEquals("0 – 0", m.h2h.get(0).score);
    assertEquals("Real Madrid", m.h2h.get(1).home); assertEquals("2 – 1", m.h2h.get(1).score);
    assertEquals("67'", m.clock); assertEquals(47, MatchCenter.minute("45'+2'"));
    MatchCenter.Model e = MatchCenter.fromEvent(new JSONObject().put("home", "Celtic").put("away", "Celta de Vigo").put("league", "Europa League").put("description", "Fase de liga").put("homeLogo", "http://no"));
    assertEquals("event", e.source); assertEquals("Celtic", e.home.name); assertEquals("", e.home.logo); assertEquals("Europa League", e.league);
    MatchCenter.Model merged = MatchCenter.merge(MatchCenter.parse(summary()), e);
    assertEquals("Fase de liga", merged.description); assertEquals("UEFA Champions League", merged.league); assertEquals("espn", merged.source);
  }

  @Test public void beforeKickOffMeetingsAndFormComeFromSeasonSeriesAndLastFiveGames() throws Exception {
    MatchCenter.Model m = MatchCenter.parse(new JSONObject("{\"header\":{\"id\":\"401882832\",\"competitions\":[{\"status\":{\"type\":{\"state\":\"pre\",\"name\":\"STATUS_SCHEDULED\"}},"
      + "\"competitors\":[{\"homeAway\":\"home\",\"team\":{\"id\":\"83\",\"displayName\":\"Barcelona\"}},{\"homeAway\":\"away\",\"team\":{\"id\":\"86\",\"displayName\":\"Real Madrid\"}}]}]},"
      + "\"lastFiveGames\":[{\"team\":{\"id\":\"83\"},\"events\":[{\"gameResult\":\"W\",\"score\":\"3-1\"},{\"gameResult\":\"L\",\"score\":\"4-2\"}]},{\"team\":{\"id\":\"86\"},\"events\":[{\"gameResult\":\"L\"}]}],"
      + "\"seasonseries\":[{\"type\":\"head-to-head\",\"events\":["
      + "{\"id\":\"1\",\"date\":\"2026-05-10T19:00:00Z\",\"status\":\"post\",\"statusType\":{\"completed\":true},\"competitionName\":\"2025-26 LALIGA\",\"competitors\":[{\"homeAway\":\"home\",\"team\":{\"displayName\":\"Barcelona\"},\"score\":\"2\"},{\"homeAway\":\"away\",\"team\":{\"displayName\":\"Real Madrid\"},\"score\":\"0\"}]},"
      + "{\"id\":\"2\",\"date\":\"2026-01-11T19:00:00Z\",\"status\":\"post\",\"competitionName\":\"2026 Supercopa de España\",\"roundName\":\"Final\",\"competitors\":[{\"homeAway\":\"home\",\"team\":{\"displayName\":\"Barcelona\"},\"score\":\"3\"},{\"homeAway\":\"away\",\"team\":{\"displayName\":\"Real Madrid\"},\"score\":\"2\"}]},"
      + "{\"id\":\"3\",\"date\":\"2027-05-09T19:00:00Z\",\"timeValid\":false,\"status\":\"pre\",\"statusType\":{\"completed\":false},\"competitors\":[{\"homeAway\":\"home\",\"team\":{\"displayName\":\"Real Madrid\"}},{\"homeAway\":\"away\",\"team\":{\"displayName\":\"Barcelona\"}}]},"
      + "{\"id\":\"401882832\",\"date\":\"2026-10-25T20:00:00Z\",\"status\":\"pre\",\"competitors\":[{\"homeAway\":\"home\",\"team\":{\"displayName\":\"Barcelona\"}},{\"homeAway\":\"away\",\"team\":{\"displayName\":\"Real Madrid\"}}]}]}]}"));
    assertEquals("scheduled", m.state);
    assertEquals(3, m.h2h.size());
    assertTrue(m.h2h.get(0).upcoming); assertFalse(m.h2h.get(0).dateKnown); assertEquals("Real Madrid", m.h2h.get(0).home); assertEquals("", m.h2h.get(0).score);
    assertEquals("Barcelona", m.h2h.get(1).home); assertEquals("2 – 0", m.h2h.get(1).score); assertEquals("2025-26 LALIGA", m.h2h.get(1).competition);
    assertEquals("2026 Supercopa de España · Final", m.h2h.get(2).competition); assertEquals("3 – 2", m.h2h.get(2).score);
    assertEquals(2, m.homeForm.size()); assertEquals("W", m.homeForm.get(0).result); assertEquals(1, m.awayForm.size());
  }
}
