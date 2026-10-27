package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import org.junit.Test;

public class PlayerDocumentTest {
  static class Connection extends HttpURLConnection {
    int response;
    String content, location;
    boolean closed;

    Connection(URL url, int response, String content) {
      super(url);
      this.response = response;
      this.content = content;
    }

    @Override
    public int getResponseCode() {
      return response;
    }

    @Override
    public String getHeaderField(String field) {
      return "Location".equals(field) ? location : null;
    }

    @Override
    public java.io.InputStream getInputStream() {
      return new ByteArrayInputStream(content.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    @Override
    public void connect() {}

    @Override
    public boolean usingProxy() {
      return false;
    }

    @Override
    public void disconnect() {
      closed = true;
    }
  }

  @Test
  public void usesInjectedTransportAndClosesConnection() throws Exception {
    Connection c = new Connection(new URL("https://example.com/player"), 200, "vídeo");
    PlayerDocument.Result result = PlayerDocument.fetch(c.getURL().toString(), url -> c);
    assertEquals("vídeo", result.html);
    assertTrue(c.closed);
    assertFalse(c.getUseCaches());
  }

  @Test
  public void preservesHttpStatusWithoutLeakingUrl() throws Exception {
    Connection c = new Connection(new URL("https://example.com/?token=private"), 403, "");
    try {
      PlayerDocument.fetch(c.getURL().toString(), url -> c);
      fail();
    } catch (PlayerDocument.HttpFailure failure) {
      assertEquals("HTTP 403", ConnectionReport.describe(failure));
      assertTrue(c.closed);
    }
  }

  @Test
  public void rejectsHttpsDowngradeBeforeOpeningRedirect() throws Exception {
    Connection c = new Connection(new URL("https://example.com/player"), 302, "");
    c.location = "http://example.com/player";
    int[] calls = {0};
    try {
      PlayerDocument.fetch(
          c.getURL().toString(),
          url -> {
            calls[0]++;
            return c;
          });
      fail();
    } catch (java.io.IOException expected) {
      assertEquals(1, calls[0]);
      assertTrue(c.closed);
    }
  }

  @Test
  public void limitsPageSizeAndClosesConnection() throws Exception {
    char[] large = new char[2 * 1024 * 1024 + 1];
    java.util.Arrays.fill(large, 'a');
    Connection c = new Connection(new URL("https://example.com/player"), 200, new String(large));
    try {
      PlayerDocument.fetch(c.getURL().toString(), url -> c);
      fail();
    } catch (java.io.IOException expected) {
      assertTrue(c.closed);
    }
  }
  @Test public void networkFailureRetriesDeviceTransportAndMarksResult() throws Exception {
    Connection alternate = new Connection(new URL("https://zicotv.cc/api/player/28"), 200, "sources");
    int[] attempts = {0};
    PlayerDocument.Result result = PlayerDocument.fetch(alternate.getURL().toString(), url -> {
      attempts[0]++; throw new java.net.UnknownHostException("private DNS unavailable");
    }, url -> { attempts[0]++; return alternate; });
    assertEquals(2, attempts[0]); assertTrue(result.usedFallback);
    assertEquals("sources", result.html); assertTrue(alternate.closed);
  }

  @Test public void httpRejectionNeverChangesTransport() throws Exception {
    Connection rejected = new Connection(new URL("https://zicotv.cc/api/player/28"), 403, "");
    try {
      PlayerDocument.fetch(rejected.getURL().toString(), url -> rejected,
          url -> { throw new AssertionError("An HTTP rejection must not change networks"); });
      fail();
    } catch (PlayerDocument.HttpFailure expected) { assertEquals(403, expected.status); }
  }

  @Test public void healthyPageKeepsSelectedTransport() throws Exception {
    Connection primary = new Connection(new URL("https://zicotv.cc/api/player/28"), 200, "sources");
    PlayerDocument.Result result = PlayerDocument.fetch(primary.getURL().toString(), url -> primary,
        url -> { throw new AssertionError("Working selected DNS must be preserved"); });
    assertFalse(result.usedFallback);
  }
  @Test public void connectionResetRetriesHttp1BeforeChangingDns() throws Exception {
    Connection http1 = new Connection(new URL("https://zicotv.cc/api/player/28"), 200, "sources");
    int[] attempts = {0};
    PlayerDocument.Result result = PlayerDocument.fetch(http1.getURL().toString(), url -> {
      attempts[0]++; throw new java.net.SocketException("Connection reset");
    }, url -> { attempts[0]++; return http1; }, url -> { throw new AssertionError("Do not change DNS after HTTP/1.1 succeeds"); });
    assertEquals(2, attempts[0]); assertTrue(result.usedHttp1); assertFalse(result.usedFallback);
    assertEquals(PlayerDocument.BROWSER_USER_AGENT, http1.getRequestProperty("User-Agent"));
  }

  @Test public void deviceConnectionIsLastRetryAfterBothProtocolAttemptsFail() throws Exception {
    Connection device = new Connection(new URL("https://zicotv.cc/api/player/28"), 200, "sources");
    int[] attempts = {0};
    PlayerDocument.ConnectionFactory reset = url -> { attempts[0]++; throw new java.net.SocketException("Connection reset"); };
    PlayerDocument.Result result = PlayerDocument.fetch(device.getURL().toString(), reset, reset, url -> device);
    assertEquals(2, attempts[0]); assertTrue(result.usedFallback); assertTrue(result.usedHttp1);
  }

  @Test public void httpRejectionStopsProtocolAndDnsRetries() throws Exception {
    Connection rejected = new Connection(new URL("https://zicotv.cc/api/player/28"), 403, "");
    PlayerDocument.ConnectionFactory unexpected = url -> { throw new AssertionError("HTTP rejection must stay unchanged"); };
    try {
      PlayerDocument.fetch(rejected.getURL().toString(), url -> rejected, unexpected, unexpected); fail();
    } catch (PlayerDocument.HttpFailure expected) { assertEquals(403, expected.status); }
  }
}
