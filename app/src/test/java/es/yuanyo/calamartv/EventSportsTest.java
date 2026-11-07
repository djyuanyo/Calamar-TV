package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.Arrays;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;

public class EventSportsTest {
  static EventSports definitions() throws Exception {
    return new EventSports(new JSONObject("{\"sports\":[{\"id\":\"soccer\",\"name\":\"Fútbol\",\"aliases\":[\"Soccer\"]},"
      + "{\"id\":\"basketball\",\"name\":\"Baloncesto\",\"aliases\":[\"Basketball\"]},{\"id\":\"other\",\"name\":\"Otros deportes\",\"aliases\":[\"Other\"]}],"
      + "\"leagues\":{\"nba\":\"basketball\",\"spanish liga acb\":\"basketball\",\"spanish primera federacion group 1\":\"soccer\",\"spanish primera federacion group 2\":\"soccer\"}}"));
  }
  static Catalog.Channel event(String id, String sport, String league) throws Exception {
    return new Catalog.Channel(new JSONObject().put("id",id).put("name",id).put("event",true)
      .put("sport",sport).put("leagueId",league),true);
  }
  @Test public void renamedSourceCompetitionsKeepTheirSport() throws Exception {
    EventSports sports = definitions();
    JSONObject custom = new JSONObject("{\"leagues\":[{\"id\":\"zico-liga-spanish-liga-acb\",\"name\":\"Baloncesto Liga ACB\"},"
      + "{\"id\":\"zico-liga-spanish-primera-federacion-group-1\",\"name\":\"Primera Federación Grupo 1\"},"
      + "{\"id\":\"zico-liga-spanish-primera-federacion-group-2\",\"name\":\"Primera Federación Grupo 2\"}]}");
    assertEquals("basketball",sports.sport(event("1","","zico-liga-spanish-liga-acb"),custom));
    assertEquals("soccer",sports.sport(event("2","","zico-liga-spanish-primera-federacion-group-1"),custom));
    assertEquals("soccer",sports.sport(event("3","","zico-liga-spanish-primera-federacion-group-2"),custom));
  }
  @Test public void exactMetadataWinsAndLegacyLeaguesStillFilter() throws Exception {
    EventSports sports = definitions();
    JSONObject custom = new JSONObject("{\"leagues\":[{\"id\":\"basket\",\"name\":\"NBA\"},{\"id\":\"football\",\"name\":\"Mi liga\",\"espn\":\"esp.1\"}]}");
    assertEquals("basketball",sports.sport(event("1","","basket"),custom));
    assertEquals("soccer",sports.sport(event("2","","football"),custom));
    assertEquals("soccer",sports.sport(event("3","Soccer","basket"),custom));
    assertEquals("other",sports.sport(event("4","","unknown"),custom));
    List<EventSports.Tab> tabs = sports.tabs(Arrays.asList(event("1","","basket"),event("2","","football"),event("3","","unknown")),custom);
    assertEquals(4,tabs.size());
    assertEquals("all",tabs.get(0).id); assertEquals(3,tabs.get(0).count);
    assertEquals(1,tabs.get(1).count); assertEquals(1,tabs.get(2).count); assertEquals(1,tabs.get(3).count);
  }
}
