package es.yuanyo.calamartv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PolymarketTest {
  static JSONObject market(String title, String yes) throws Exception {
    return new JSONObject().put("sportsMarketType", "moneyline").put("groupItemTitle", title)
        .put("outcomePrices", new JSONArray().put(yes).put("0.5").toString()).put("volume", "1000");
  }

  static JSONObject event(String title, String home, String away, String... prices) throws Exception {
    return new JSONObject().put("title", title).put("slug", "lal-vil-esp")
        .put("teams", new JSONArray().put(new JSONObject().put("name", home).put("ordering", "home"))
            .put(new JSONObject().put("name", away).put("ordering", "away")))
        .put("markets", new JSONArray().put(market(home, prices[0])).put(market("Draw (" + home + " vs. " + away + ")", prices[1])).put(market(away, prices[2])));
  }

  @Test public void teamNamesFromEspnMatchPolymarket() {
    assertTrue(Polymarket.teamScore("Atlético Madrid", "Club Atlético de Madrid") > 0);
    assertTrue(Polymarket.teamScore("Celta Vigo", "RC Celta de Vigo") > 0);
    assertEquals(10, Polymarket.teamScore("Villarreal", "Villarreal CF"));
    assertEquals(0, Polymarket.teamScore("Real Madrid", "Real Betis Balompié"));
  }

  @Test public void oddsAddUpToOneHundred() throws Exception {
    Polymarket.Odds o = Polymarket.eventOdds(event("Villarreal CF vs. RCD Espanyol", "Villarreal CF", "RCD Espanyol", "0.31", "0.305", "0.455"));
    assertEquals(29, o.home); assertEquals(28, o.draw); assertEquals(43, o.away);
    assertEquals(3000, o.volume, 0.01);
    assertEquals("https://polymarket.com/event/lal-vil-esp", o.url);
  }

  @Test public void pickSkipsHalfTimeAndTurnsSwappedTeams() throws Exception {
    JSONArray events = new JSONArray()
        .put(event("Villarreal CF vs. RCD Espanyol - Halftime Result", "Villarreal CF", "RCD Espanyol", "0.9", "0.05", "0.05"))
        .put(event("Villarreal CF vs. RCD Espanyol", "Villarreal CF", "RCD Espanyol", "0.31", "0.305", "0.455"));
    Polymarket.Odds same = Polymarket.pick(events, "Villarreal", "Espanyol");
    assertEquals(29, same.home); assertEquals(43, same.away);
    Polymarket.Odds turned = Polymarket.pick(events, "Espanyol", "Villarreal");
    assertEquals(43, turned.home); assertEquals(28, turned.draw); assertEquals(29, turned.away);
    assertNull(Polymarket.pick(events, "Barcelona", "Alavés"));
  }

  @Test public void queryAsksAWindowAroundKickOffByPages() throws Exception {
    long kickoff = 1791633600000L; // 2026-10-10T12:00:00Z
    assertEquals(Polymarket.API + "?tag_id=100350&closed=false&limit=100&offset=100&end_date_min=2026-10-10T11%3A15%3A00Z&end_date_max=2026-10-10T12%3A45%3A00Z",
        Polymarket.query(kickoff, 1));
  }

  @Test public void tokensFollowTheTeamsAndGoalsMarketsAreRead() throws Exception {
    JSONObject e = event("Villarreal CF vs. RCD Espanyol", "Villarreal CF", "RCD Espanyol", "0.31", "0.305", "0.455");
    for (int i = 0; i < 3; i++) e.getJSONArray("markets").getJSONObject(i).put("clobTokenIds", new JSONArray().put("100000000" + i).put("x").toString());
    Polymarket.Odds same = Polymarket.pick(new JSONArray().put(e), "Villarreal", "Espanyol");
    assertEquals("1000000000", same.tokens[0]); assertEquals("1000000002", same.tokens[2]);
    Polymarket.Odds turned = Polymarket.pick(new JSONArray().put(e), "Espanyol", "Villarreal");
    assertEquals("1000000002", turned.tokens[0]); assertEquals("1000000000", turned.tokens[2]);
    JSONArray markets = new JSONArray()
        .put(new JSONObject().put("sportsMarketType", "totals").put("line", 1.5).put("outcomePrices", "[\"0.84\",\"0.16\"]"))
        .put(new JSONObject().put("sportsMarketType", "totals").put("line", 2.5).put("closed", true).put("outcomePrices", "[\"0.6\",\"0.4\"]"))
        .put(new JSONObject().put("sportsMarketType", "both_teams_to_score").put("outcomePrices", "[\"0.57\",\"0.43\"]"));
    Polymarket.goals(new JSONObject().put("markets", markets), same);
    assertEquals(java.util.Arrays.asList("+1,5 goles", "Ambos marcan"), same.goalLabels);
    assertEquals(java.util.Arrays.asList(84, 57), same.goalPcts);
    double[][] s = Polymarket.series(new JSONObject("{\"history\":[{\"t\":1,\"p\":0.6},{\"t\":2,\"p\":0.655}]}"));
    assertEquals(2, s.length); assertEquals(65.5, s[1][1], 0.001);
  }
}
