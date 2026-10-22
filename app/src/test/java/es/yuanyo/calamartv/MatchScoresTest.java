package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import org.junit.Test;
import org.json.*;

public class MatchScoresTest {
  JSONObject fixture(String name,String state,boolean completed)throws Exception {
    return new JSONObject().put("id","401882870").put("date","2026-10-21T18:00Z").put("competitions",new JSONArray().put(new JSONObject()
      .put("status",new JSONObject().put("displayClock","74'").put("type",new JSONObject().put("name",name).put("state",state).put("completed",completed)))
      .put("competitors",new JSONArray().put(new JSONObject().put("homeAway","home").put("score","2").put("team",new JSONObject().put("displayName","Levante")))
      .put(new JSONObject().put("homeAway","away").put("score","1").put("team",new JSONObject().put("displayName","Athletic Club"))))));
  }
  @Test public void acceptsOnlyGoogleLinks()throws Exception{
    assertEquals("share.google",MatchScores.google("https://share.google/RSJmsOE0s8wgQUT3n").getHost());
    assertEquals("levante contra athletic club",MatchScores.query(MatchScores.google("https://www.google.com/search?q=levante+contra+athletic+club")));
    for(String link:new String[]{"http://share.google/a","https://share.google.evil/a","https://user@www.google.com/search?q=a","https://evil/search?q=a"})try{MatchScores.google(link);fail(link);}catch(Exception expected){}
  }
  @Test public void realClockAndFinalStates()throws Exception{
    assertEquals("2 – 1 · En juego · 74′",MatchScores.parse(fixture("STATUS_SECOND_HALF","in",false)).text);
    assertEquals("2 – 1 · Descanso",MatchScores.parse(fixture("STATUS_HALFTIME","in",false)).text);
    assertEquals("2 – 1 · Finalizado",MatchScores.parse(fixture("STATUS_FULL_TIME","post",true)).text);
    assertEquals("cancelled",MatchScores.parse(fixture("STATUS_CANCELED","post",true)).state);
    assertEquals("suspended",MatchScores.parse(fixture("STATUS_ABANDONED","post",true)).state);
    assertEquals("Aplazado",MatchScores.parse(fixture("STATUS_POSTPONED","pre",false)).text);
    assertEquals("Programado",MatchScores.parse(fixture("STATUS_SCHEDULED","pre",false)).text);
  }
  @Test public void theLinkDecidesTheMatchEvenWhenTheEventDataDiffers()throws Exception{
    JSONObject e=fixture("STATUS_SECOND_HALF","in",false),board=new JSONObject().put("events",new JSONArray().put(e));
    assertEquals("401882870",MatchScores.identify(board,"levante ud contra athletic club","2026-10-21T18:00:00Z").getString("id"));
    assertEquals("401882870",MatchScores.identify(board,"levante ud contra athletic club","2027-01-01T18:00:00Z").getString("id"));
    assertEquals("401882870",MatchScores.identify(board,"levante ud contra athletic club","").getString("id"));
    assertFalse(MatchScores.identify(board,"levante contra real madrid","2026-10-21T18:00:00Z").getBoolean("bothTeams"));
    JSONObject later=new JSONObject(e.toString()).put("id","401882999").put("date","2026-10-28T18:00Z");
    assertEquals("401882870",MatchScores.identify(new JSONObject().put("events",new JSONArray().put(later).put(e)),"levante contra athletic club","2026-10-21T20:00:00Z").getString("id"));
    try{MatchScores.identify(board,"real madrid contra juventus","2026-10-21T18:00:00Z");fail();}catch(java.io.IOException expected){}
    assertEquals("2026-10-21T18:00:00Z",MatchScores.iso("2026-10-21T18:00Z"));
  }
  @Test public void spanishAndPartialNamesButNotASharedWordAlone()throws Exception{
    JSONObject e=fixture("STATUS_SECOND_HALF","in",false);
    JSONArray teams=e.getJSONArray("competitions").getJSONObject(0).getJSONArray("competitors");
    teams.getJSONObject(0).put("team",new JSONObject().put("displayName","Bayern Munich").put("abbreviation","BAY"));
    teams.getJSONObject(1).put("team",new JSONObject().put("displayName","Club Brugge"));
    JSONObject board=new JSONObject().put("events",new JSONArray().put(e));
    assertTrue(MatchScores.identify(board,"Bayern de Múnich - Brujas","").getBoolean("bothTeams"));
    teams.getJSONObject(0).put("team",new JSONObject().put("displayName","Real Betis"));
    teams.getJSONObject(1).put("team",new JSONObject().put("displayName","Sevilla"));
    try{MatchScores.identify(board,"real madrid","");fail();}catch(java.io.IOException expected){}
  }
  @Test public void endTimestampAndFiveMinuteGraceAreNotEstimatedFromKickoff()throws Exception{
    long end=SportsCatalog.instant("2026-10-21T20:10:00Z");
    JSONObject data=new JSONObject().put("header",fixture("STATUS_FULL_TIME","post",true)).put("meta",new JSONObject().put("gameState","post").put("lastPlayWallClock","2026-10-21T20:10:00Z"));
    MatchScores.Result r=MatchScores.parse(data);assertEquals(end,r.finishedAt);
    MatchScores.remember("90000001",r,end+1000);
    assertFalse(MatchScores.expired("90000001",end+299999));assertTrue(MatchScores.expired("90000001",end+300000));
    MatchScores.Result fallback=MatchScores.parse(fixture("STATUS_FULL_TIME","post",true));
    assertEquals(0,fallback.finishedAt);MatchScores.remember("90000002",fallback,end);MatchScores.remember("90000002",fallback,end+290000);
    assertEquals(end+300000,MatchScores.deadline("90000002"));
    MatchScores.remember("90000002",MatchScores.parse(fixture("STATUS_SECOND_HALF","in",false)),end+300001);
    assertFalse(MatchScores.expired("90000002",end+300002));
  }
  @Test public void spanishClubBrujasLinkMatchesClubBruggeAndLens()throws Exception{
    JSONObject e=fixture("STATUS_SECOND_HALF","in",false).put("id","401915388");
    JSONArray teams=e.getJSONArray("competitions").getJSONObject(0).getJSONArray("competitors");
    teams.getJSONObject(0).put("team",new JSONObject().put("displayName","Club Brugge"));
    teams.getJSONObject(1).put("team",new JSONObject().put("displayName","Lens"));
    assertEquals("401915388",MatchScores.identify(new JSONObject().put("events",new JSONArray().put(e)),"club brujas contra racing club de lens","2026-10-21T18:00:00Z").getString("id"));
  }
}
