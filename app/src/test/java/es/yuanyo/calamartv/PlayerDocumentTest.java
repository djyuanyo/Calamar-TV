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
}
