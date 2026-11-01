package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.net.URI;
import java.net.URLDecoder;
import org.junit.Test;

public class BrowserPlaybackTest {
  @Test public void channelBrowserKeepsStablePagesOutOfRequestsAndRejectsOtherSites() throws Exception {
    for (String source : new String[] {"https://bp.zicotv.cc/api/player/4", "https://bp.zicotv.cc/events/98019"}) {
      URI page = URI.create(BrowserPlayback.channelPage(source));
      assertEquals("djyuanyo.github.io", page.getHost());
      assertNull(page.getRawQuery());
      assertEquals(source, URLDecoder.decode(page.getRawFragment(), "UTF-8"));
    }
    for (String bad : new String[] {"http://bp.zicotv.cc/api/player/4", "https://zicotv.cc.evil.test/api/player/4", "https://user:secret@bp.zicotv.cc/api/player/4", "https://bp.zicotv.cc/admin"}) {
      try { BrowserPlayback.channelPage(bad); fail("Accepted an unsupported player page"); }
      catch (IllegalArgumentException expected) { }
    }
  }

  @Test
  public void signedSourceIsPreservedAndNeverInHostingQuery() throws Exception {
    String source = "https://cdn.example/live/INDEX.M3U8?token=a%2Bb%2Fc-1799999999-&x=1+2";
    URI page = URI.create(BrowserPlayback.page(source));
    assertEquals(
        "https://djyuanyo.github.io/Calamar-TV/direct-player.html", page.toString().split("#")[0]);
    assertNull(page.getRawQuery());
    assertEquals(source, URLDecoder.decode(page.getRawFragment(), "UTF-8"));
  }

  @Test
  public void browserOnlyReceivesHttpsHls() {
    assertFalse(BrowserPlayback.supports(null));
    assertFalse(BrowserPlayback.supports("http://cdn.example/live.m3u8"));
    assertFalse(BrowserPlayback.supports("https://cdn.example/live.mpd"));
    assertFalse(BrowserPlayback.supports("https://user:secret@cdn.example/live.m3u8"));
    assertFalse(BrowserPlayback.supports("javascript:alert(1)"));
    assertTrue(BrowserPlayback.supports("https://cdn.example/live.m3u8?token=abc"));
  }
}
