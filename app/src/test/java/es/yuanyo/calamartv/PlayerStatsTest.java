package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PlayerStatsTest {
  @Test public void requestsKeepTheSelectedMatchTeamAndSeason() {
    MatchCenter.Model match = new MatchCenter.Model();
    match.id = "700"; match.leagueCode = "esp.2"; match.seasonYear = "2026"; match.seasonType = "1";
    MatchCenter.Player player = new MatchCenter.Player();
    player.id = "42"; player.teamId = "99";
    assertTrue(PlayerStats.matchUrl(match, player).contains("esp.2/events/700/competitions/700/competitors/99/roster/42/"));
    assertTrue(PlayerStats.seasonUrl(match, player).contains("esp.2/seasons/2026/types/1/athletes/42/"));
    match.leagueCode = "../esp.1";
    assertEquals("", PlayerStats.matchUrl(match, player));
    assertEquals("", PlayerStats.seasonUrl(match, player));
  }
  @Test public void rowsPreserveZerosAndFormatRatiosWithoutInventingMissingValues() throws Exception {
    JSONArray values = new JSONArray("[{\"name\":\"minutes\",\"value\":90},{\"name\":\"totalGoals\",\"value\":0},"
        + "{\"name\":\"passPct\",\"value\":0.875,\"displayValue\":\"0.9\"},{\"name\":\"saves\",\"value\":4},"
        + "{\"name\":\"goalAssists\",\"displayValue\":\"-\"}]");
    List<PlayerStats.Row> rows = PlayerStats.rows(values, "G");
    assertEquals(4, rows.size());
    assertEquals("90", rows.get(0).value);
    assertEquals("0", rows.get(1).value);
    assertEquals("87,5%", rows.get(2).value);
    assertEquals("Paradas", rows.get(3).label);
    assertEquals(3, PlayerStats.rows(values, "F").size());
    assertTrue(PlayerStats.rows((JSONObject) null, "G").isEmpty());
  }
}
