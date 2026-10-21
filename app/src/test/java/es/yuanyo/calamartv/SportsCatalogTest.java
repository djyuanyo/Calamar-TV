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
  @Test public void highlightsMixEventsAndChannelsAndEventsStayChronological() throws Exception {
    JSONObject data=new JSONObject("{\"channels\":[{\"id\":\"c\",\"name\":\"Channel\",\"streams\":[\"https://example.com/a.m3u8\"]}],\"featured\":[\"c\"],\"hidden\":[],\"leagues\":[{\"id\":\"l\",\"name\":\"League\"}],\"events\":[{\"id\":\"b\",\"name\":\"Later\",\"cover\":\"https://example.com/b.jpg\",\"channelId\":\"c\",\"leagueId\":\"l\",\"startAt\":\"2026-12-01T20:00:00Z\",\"featured\":true},{\"id\":\"a\",\"name\":\"Earlier\",\"cover\":\"https://example.com/a.jpg\",\"channelId\":\"c\",\"startAt\":\"2026-11-01T20:00:00Z\"}]}");
    SharedCatalog.validate(data);List<Catalog.Channel> all=Catalog.merge(null,data);
    assertEquals("a",Catalog.events(all,data).get(0).id);assertEquals("b",Catalog.highlights(all,data).get(0).id);assertEquals("c",Catalog.highlights(all,data).get(1).id);
    assertTrue(Catalog.highlights(all,data).get(0).meta.contains("League"));
  }
}
