package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.net.InetAddress;
import java.net.URL;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.Test;

public class PlayerHttpConnectionTest {
  @Test
  public void pageFetchUsesInjectedDnsAndPreservesHeaders() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(new MockResponse().setBody("video"));
      server.start();
      AtomicInteger lookups = new AtomicInteger();
      OkHttpClient client =
          new OkHttpClient.Builder()
              .dns(
                  host -> {
                    assertEquals("video.example", host);
                    lookups.incrementAndGet();
                    return Collections.singletonList(
                        InetAddress.getByAddress(new byte[] {127, 0, 0, 1}));
                  })
              .build();
      PlayerHttpConnection connection =
          new PlayerHttpConnection(
              new URL("http://video.example:" + server.getPort() + "/player"), client);
      connection.setRequestProperty("User-Agent", "CalamarTest");
      try {
        assertEquals(200, connection.getResponseCode());
        assertEquals('v', connection.getInputStream().read());
        assertTrue(lookups.get() > 0);
        assertEquals("CalamarTest", server.takeRequest().getHeader("User-Agent"));
      } finally {
        connection.disconnect();
      }
    }
  }

  @Test
  public void readerControlsRedirectsInsteadOfFollowingThemSilently() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(
          new MockResponse()
              .setResponseCode(302)
              .addHeader("Location", "https://other.example/player"));
      server.start();
      PlayerHttpConnection c =
          new PlayerHttpConnection(server.url("/player").url(), new OkHttpClient());
      try {
        assertEquals(302, c.getResponseCode());
        assertEquals("https://other.example/player", c.getHeaderField("Location"));
      } finally {
        c.disconnect();
      }
      assertEquals(1, server.getRequestCount());
    }
  }

  @Test
  public void headProbeCanCloseWithoutReadingLiveMedia() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(new MockResponse().setResponseCode(200));
      server.start();
      PlayerHttpConnection c =
          new PlayerHttpConnection(server.url("/live.ts").url(), new OkHttpClient());
      c.setRequestMethod("HEAD");
      try {
        assertEquals(200, c.getResponseCode());
        assertEquals("HEAD", server.takeRequest().getMethod());
      } finally {
        c.disconnect();
      }
    }
  }
}
