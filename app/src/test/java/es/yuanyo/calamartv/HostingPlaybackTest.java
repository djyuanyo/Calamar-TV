package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import java.io.IOException;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.Test;

public class HostingPlaybackTest {
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
