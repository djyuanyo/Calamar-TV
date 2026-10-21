package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import org.junit.Test;
import org.json.*;
import java.util.*;
public class SportsCatalogTest {
  @Test public void madridTimeUsesDaylightSavingAndRejectsImpossibleDates() throws Exception {
    assertEquals("2026-12-01T20:00:00.000Z",SportsCatalog.fromMadrid("2026-12-01 21:00"));
    assertEquals("2026-07-01T19:00:00.000Z",SportsCatalog.fromMadrid("2026-07-01 21:00"));
    for(String s:new String[]{"2026-02-30 21:00","2026-03-29 02:30"})try{SportsCatalog.fromMadrid(s);fail("Accepted "+s);}catch(JSONException expected){}
  }
  @Test public void eventsShowTheirStartUntilTheyBegin() {
    long before=SportsCatalog.instant("2026-12-01T19:30:00Z"), after=SportsCatalog.instant("2026-12-01T20:00:00Z");
    String upcoming=SportsCatalog.label("scheduled","2026-12-01T20:00:00.000Z",before);
    assertTrue(upcoming, upcoming.contains("1 dic") && upcoming.endsWith("21:00"));
    assertEquals(SportsCatalog.LIVE,SportsCatalog.label("scheduled","2026-12-01T20:00:00.000Z",after));
    assertEquals("Finalizado",SportsCatalog.label("finished","2026-12-01T20:00:00.000Z",before));
    assertEquals(SportsCatalog.LIVE,SportsCatalog.label("live","",before));
    assertEquals("Programado",SportsCatalog.label("scheduled","",before));
  }
  @Test public void homeRowsGroupEventsByLeagueAndCategoriesFollowTheSavedOrder() throws Exception {
    JSONObject data=new JSONObject("{\"channels\":[{\"id\":\"c\",\"name\":\"Channel\",\"group\":\"Zeta\",\"streams\":[\"https://example.com/a.m3u8\"]},{\"id\":\"d\",\"name\":\"Other\",\"group\":\"Deportes\",\"streams\":[\"https://example.com/b.m3u8\"]}],\"featured\":[],\"hidden\":[],\"groupOrder\":[\"Zeta\"],\"leagues\":[{\"id\":\"l\",\"name\":\"League\",\"logo\":\"https://example.com/l.png\"}],\"events\":[{\"id\":\"b\",\"name\":\"Later\",\"cover\":\"https://example.com/b.jpg\",\"channelId\":\"c\",\"leagueId\":\"l\",\"startAt\":\"2026-12-01T20:00:00Z\"},{\"id\":\"x\",\"name\":\"Free\",\"cover\":\"https://example.com/x.jpg\",\"channelId\":\"c\",\"startAt\":\"2026-10-01T20:00:00Z\"},{\"id\":\"a\",\"name\":\"Earlier\",\"cover\":\"https://example.com/a.jpg\",\"channelId\":\"c\",\"leagueId\":\"l\",\"startAt\":\"2026-11-01T20:00:00Z\"}]}");
    SharedCatalog.validate(data);List<Catalog.Channel> all=Catalog.merge(null,data);
    List<Catalog.EventRow> rows=Catalog.eventRows(Catalog.events(all,data),data);
    assertEquals("League",rows.get(0).name);assertEquals("https://example.com/l.png",rows.get(0).logo);
    assertEquals("a",rows.get(0).events.get(0).id);assertEquals("b",rows.get(0).events.get(1).id);
    assertEquals("Otros eventos",rows.get(1).name);assertEquals("x",rows.get(1).events.get(0).id);
    assertEquals(Arrays.asList("Zeta","Deportes"),new ArrayList<>(Catalog.groups(all,data).keySet()));
    assertEquals(Arrays.asList("Deportes","Zeta"),new ArrayList<>(Catalog.groups(all).keySet()));
    data.put("groupOrder",new JSONArray("[\"Zeta\",\"Zeta\"]"));
    try{SharedCatalog.validate(data);fail("Accepted repeated categories");}catch(JSONException expected){}
  }
  @Test public void categoriesGiveOneColourPerCategoryAndCanBeRenamed() throws Exception {
    JSONObject tdt=new JSONObject("{\"channels\":[{\"id\":\"gol\",\"name\":\"Gol\",\"group\":\"Deportes\",\"streams\":[\"https://example.com/g.m3u8\"]},{\"id\":\"tele\",\"name\":\"Tele\",\"group\":\"Deportes\",\"streams\":[\"https://example.com/t.m3u8\"]},{\"id\":\"la-1\",\"name\":\"La 1\",\"group\":\"Generalistas\",\"streams\":[\"https://example.com/l.m3u8\"]}]}");
    List<Catalog.Channel> all=Catalog.merge(tdt,new JSONObject());
    assertEquals(0xff1d7a40,all.get(0).color);assertEquals(all.get(0).color,all.get(1).color);assertEquals(0xff1f4f8f,all.get(2).color);
    assertEquals(Catalog.defaultColor("Cine"),Catalog.defaultColor("Cine"));
    JSONObject custom=new JSONObject("{\"channels\":[],\"featured\":[],\"hidden\":[],\"categories\":[{\"id\":\"Generalistas\",\"name\":\"Generalistas\",\"color\":\"#1f4f8f\"},{\"id\":\"Deportes\",\"name\":\"Fútbol\",\"color\":\"#aa0000\"}]}");
    SharedCatalog.validate(custom);all=Catalog.merge(tdt,custom);
    assertEquals("Fútbol",all.get(0).group);assertEquals("Deportes",all.get(0).category);assertEquals(0xffaa0000,all.get(0).color);
    assertEquals(Arrays.asList("Generalistas","Fútbol"),new ArrayList<>(Catalog.groups(all,custom).keySet()));
    custom.put("categories",new JSONArray("[{\"id\":\"a\",\"name\":\"A\",\"color\":\"red\"}]"));
    try{SharedCatalog.validate(custom);fail("Accepted a bad colour");}catch(JSONException expected){}
  }
  @Test public void highlightsMixEventsAndChannelsAndEventsStayChronological() throws Exception {
    JSONObject data=new JSONObject("{\"channels\":[{\"id\":\"c\",\"name\":\"Channel\",\"streams\":[\"https://example.com/a.m3u8\"]}],\"featured\":[\"c\"],\"hidden\":[],\"leagues\":[{\"id\":\"l\",\"name\":\"League\"}],\"events\":[{\"id\":\"b\",\"name\":\"Later\",\"cover\":\"https://example.com/b.jpg\",\"channelId\":\"c\",\"leagueId\":\"l\",\"startAt\":\"2026-12-01T20:00:00Z\",\"featured\":true},{\"id\":\"a\",\"name\":\"Earlier\",\"cover\":\"https://example.com/a.jpg\",\"channelId\":\"c\",\"startAt\":\"2026-11-01T20:00:00Z\"}]}");
    SharedCatalog.validate(data);List<Catalog.Channel> all=Catalog.merge(null,data);
    assertEquals("a",Catalog.events(all,data).get(0).id);assertEquals("b",Catalog.highlights(all,data).get(0).id);assertEquals("c",Catalog.highlights(all,data).get(1).id);
    assertTrue(Catalog.highlights(all,data).get(0).meta.contains("League"));
  }
}
