package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.net.*;
import java.util.*;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import org.junit.Test;
public class MultiSourceTest {
  @Test public void eachZicoTileResolvesAndRenewsOnOwnedHostingWithNoDevicePageRequest() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      for (int i=0;i<2;i++) server.enqueue(new MockResponse().setBody("{\"url\":\"calamar-player.php?seg=playlist&sig="+i+"\"}"));
      server.start(); OkHttpClient client=new OkHttpClient(); List<String> hosts=new ArrayList<>();
      PlayerDocument.ConnectionFactory hosting=url->{hosts.add(url.getHost());if(url.getHost().equals("calamarmenciano.com"))throw new UnknownHostException("root reset");return new PlayerHttpConnection(server.url(url.getFile()).url(),client);};
      PlayerDocument.ConnectionFactory device=url->{throw new AssertionError("A Zico tile must not contact its provider: "+url.getHost());};
      MultiSource.Result result=MultiSource.resolve("https://zicotv.cc/api/player/1",Library.PLAYER_ENDPOINT,"fedcba9876543210",0,hosting,device);
      assertTrue(result.hosted()); assertTrue(result.renewable()); assertEquals("www.calamarmenciano.com",URI.create(result.url).getHost());
      assertEquals("fedcba9876543210",server.takeRequest().getRequestUrl().queryParameter("source_id"));
      MultiSource.Result renewed=MultiSource.resolve(result.page,HostingPlayback.endpoint(result.url),"fedcba9876543210",1,hosting,device);
      assertNotEquals(result.url,renewed.url); assertEquals(3,hosts.size()); assertEquals("www.calamarmenciano.com",hosts.get(2));
      assertEquals("fedcba9876543210",server.takeRequest().getRequestUrl().queryParameter("source_id"));
    }
  }
  @Test public void rawMediaNeverFetchesAPlayerDocument() throws Exception {
    PlayerDocument.ConnectionFactory forbidden=url->{throw new AssertionError("Unexpected lookup");};
    MultiSource.Result media=MultiSource.resolve("https://example.com/live.m3u8",Library.PLAYER_ENDPOINT,"",0,forbidden,forbidden);
    assertFalse(media.renewable());assertEquals(-1,media.renewalDelay());assertNull(media.referer);
  }
  @Test public void eventLookupUsesHostingAndKeepsLockedPlayersExcluded() throws Exception {
    try(MockWebServer server=new MockWebServer()) {
      server.enqueue(new MockResponse().setBody("{\"data\":{\"sources\":[{\"player_url\":\"https://zicotv.cc/api/player/99\",\"locked\":true},{\"player_url\":\"https://zicotv.cc/api/player/2\"}]}}"));
      server.enqueue(new MockResponse().setBody("{\"url\":\"calamar-player.php?seg=playlist&sig=ok\"}"));server.start();OkHttpClient client=new OkHttpClient();
      PlayerDocument.ConnectionFactory hosting=url->new PlayerHttpConnection(server.url(url.getFile()).url(),client);
      MultiSource.Result result=MultiSource.resolve("https://zicotv.cc/events/12",Library.PLAYER_ENDPOINT,"",0,hosting,url->{throw new AssertionError("Provider page requested");});
      assertEquals("https://zicotv.cc/api/player/2",result.page);assertEquals("https://zicotv.cc/events/12",server.takeRequest().getRequestUrl().queryParameter("event"));
      assertEquals("https://zicotv.cc/api/player/2",server.takeRequest().getRequestUrl().queryParameter("page"));
    }
  }
  @Test public void refererIncludesOnlyThePageOriginAndNeverMediaCredentials() {
    assertNull(new MultiSource.Result("https://media.example/live.m3u8",null,"https://user:password@media.example/private?token=secret").referer);
    assertEquals("https://page.example/",new MultiSource.Result("https://cdn.example/live.m3u8","https://page.example/watch","https://user:password@page.example/watch?token=secret").referer);
  }

}
