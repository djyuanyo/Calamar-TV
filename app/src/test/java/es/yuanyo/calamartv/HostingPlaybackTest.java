package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.Test;

public class HostingPlaybackTest {
  @Test public void countOnlyRelayStillSelectsEverySignalThroughHosting() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(new MockResponse().setBody("{\"sources\":5}"));
      server.enqueue(new MockResponse().setBody("{\"url\":\"calamar-player.php?seg=playlist&sig=ok\"}")); server.start();
      OkHttpClient client = new OkHttpClient();
      PlayerDocument.ConnectionFactory network = url -> new PlayerHttpConnection(server.url(url.getFile()).url(), client);
      java.util.List<HostingPlayback.Option> options = HostingPlayback.options("https://zicotv.cc/api/player/6", "LaLiga", network);
      assertEquals(6, options.size()); assertEquals("LaLiga · Señal 5", options.get(5).name);
      server.takeRequest(); HostingPlayback.resolve("https://zicotv.cc/api/player/6", options.get(5).id, network);
      assertEquals("4", server.takeRequest().getRequestUrl().queryParameter("src"));
    }
  }

  @Test public void everySignalHasAChannelNameAndSelectionId() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(new MockResponse().setBody("{\"name\":\"LaLiga\",\"items\":[{\"id\":\"0123456789abcdef\",\"name\":\"LaLiga · Señal 1\"},{\"id\":\"fedcba9876543210\",\"name\":\"LaLiga · Señal 2\"}]}"));
      server.enqueue(new MockResponse().setBody("{\"url\":\"calamar-player.php?seg=playlist&sig=ok\"}")); server.start();
      OkHttpClient client = new OkHttpClient();
      PlayerDocument.ConnectionFactory network = url -> new PlayerHttpConnection(server.url(url.getFile()).url(), client);
      java.util.List<HostingPlayback.Option> options = HostingPlayback.options("https://zicotv.cc/api/player/6", "Canal", network);
      assertEquals(3, options.size()); assertEquals("LaLiga · Automática", options.get(0).name); assertEquals("LaLiga · Señal 2", options.get(2).name);
      server.takeRequest();
      HostingPlayback.resolve("https://zicotv.cc/api/player/6", options.get(2).id, network);
      assertEquals("fedcba9876543210", server.takeRequest().getRequestUrl().queryParameter("source_id"));
      assertEquals("Canal", HostingPlayback.label("Zico TV · calamarmenciano.com", "Canal"));
    }
  }

  @Test public void automaticUsesTheWorking55RouteAndRetriesOtherSignalsWithoutChangingManualChoice() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      for (int i = 0; i < 3; i++) server.enqueue(new MockResponse().setBody("{\"url\":\"calamar-player.php?seg=playlist&sig=ok\"}"));
      server.start();
      OkHttpClient client = new OkHttpClient();
      PlayerDocument.ConnectionFactory network = url -> new PlayerHttpConnection(server.url(url.getFile()).url(), client);
      String page = "https://zicotv.cc/api/player/6";
      HostingPlayback.resolve(page, HostingPlayback.AUTOMATIC, 0, network);
      okhttp3.HttpUrl automatic = server.takeRequest().getRequestUrl();
      assertNull(automatic.queryParameter("source_id")); assertNull(automatic.queryParameter("src"));
      assertEquals("1", automatic.queryParameter("cast"));
      HostingPlayback.resolve(page, HostingPlayback.AUTOMATIC, 2, network);
      assertEquals("2", server.takeRequest().getRequestUrl().queryParameter("intento"));
      HostingPlayback.resolve(page, "fedcba9876543210", 2, network);
      okhttp3.HttpUrl manual = server.takeRequest().getRequestUrl();
      assertEquals("fedcba9876543210", manual.queryParameter("source_id")); assertNull(manual.queryParameter("intento"));
    }
  }

  @Test public void acceptsOnlySignedListsOnOurHosting() throws Exception {
    String path = "calamar-player.php?seg=abc&p=def&sig=012345&l=1";
    assertEquals("https://calamarmenciano.com/" + path,
        HostingPlayback.signedUrl("{\"url\":\"" + path + "\"}"));
    for (String url : new String[]{"https://cdn.zicotv.cc/live.m3u8", "https://calamarmenciano.com.evil.test/calamar-player.php?seg=a&sig=b",
        "http://calamarmenciano.com/calamar-player.php?seg=a&sig=b", "https://user@calamarmenciano.com/calamar-player.php?seg=a&sig=b",
        "https://calamarmenciano.com/other.php?seg=a&sig=b", "https://calamarmenciano.com/calamar-player.php?page=a"}) {
      try { HostingPlayback.signedUrl("{\"url\":\"" + url + "\"}"); fail(url); }
      catch (IOException expected) { }
    }
  }

  @Test public void resolvesThroughHostingAndPreservesUpstreamRejection() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(new MockResponse().setBody("{\"url\":\"calamar-player.php?seg=playlist&sig=one&l=1\"}"));
      server.enqueue(new MockResponse().setResponseCode(502).setBody("{\"error\":\"La página del reproductor no responde (403).\"}"));
      server.start();
      OkHttpClient client = new OkHttpClient();
      PlayerDocument.ConnectionFactory network = url -> new PlayerHttpConnection(server.url(url.getFile()).url(), client);
      String page = "https://zicotv.cc/api/player/4";
      assertTrue(HostingPlayback.resolve(page, network).startsWith(Library.PLAYER_ENDPOINT + "?seg="));
      okhttp3.mockwebserver.RecordedRequest request = server.takeRequest();
      assertEquals(page, request.getRequestUrl().queryParameter("page"));
      assertEquals("1", request.getRequestUrl().queryParameter("cast"));
      try { HostingPlayback.resolve(page, network); fail(); }
      catch (IOException rejected) {
        assertTrue(rejected.getMessage().contains("Hosting HTTP 502"));
        assertTrue(rejected.getMessage().contains("(403)"));
      }
    }
  }
}
