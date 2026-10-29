package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import org.junit.Test;

public class CastSourceTest {
  @Test public void luluStreamFilmsGoToTheTvThroughTheHosting() {
    String film = Library.Media.hosting("https://lulustream.com/shrtan7z8hmm");
    assertEquals("https://calamarmenciano.com/calamar-lulu.php?code=shrtan7z8hmm&hls=1", film);
    assertEquals("application/x-mpegURL", CastSource.contentType(film));
    assertTrue(CastSource.onDemand(film));
    assertFalse(CastSource.onDemand("https://example.com/live.m3u8"));
    assertFalse(CastSource.onDemand("https://calamarmenciano.com/calamar-lulu.php?introdb=1"));
  }
  @Test public void supportsDirectMediaWithoutChangingSignedLinks() {
    assertEquals("application/x-mpegURL", CastSource.contentType("https://example.com/a.M3U8?token=A%2Bb&x=1"));
    assertEquals("application/dash+xml", CastSource.contentType("https://example.com/a.mpd"));
    assertEquals("video/mp4", CastSource.contentType("http://example.com/a.mp4"));
    assertEquals("video/webm", CastSource.contentType("https://example.com/a.webm"));
    assertTrue(CastSource.live("application/x-mpegURL"));
    assertFalse(CastSource.live("video/mp4"));
  }

  @Test public void pagesBlobUrlsAndRawTsAreNotSentAsPlayableMedia() {
    assertNull(CastSource.contentType("https://example.com/a.ts"));
    assertNull(CastSource.contentType("http://192.0.2.1:8080/User/Pass/244"));
    assertNull(CastSource.contentType("https://example.com/embed/player"));
    assertNull(CastSource.contentType("blob:https://example.com/abc"));
    assertNull(CastSource.contentType("https://user:pass@example.com/a.m3u8"));
    assertNull(CastSource.contentType(null));
  }
  @Test public void publicIptvHostsUseHostingTranscoder() {
    assertTrue(CastSource.needsBridge("http://31.43.191.125:8080/Test/Pass/123"));
    assertTrue(CastSource.needsBridge("http://31.43.191.125:8080/Test/Pass/123.ts"));
    assertFalse(CastSource.needsBridge("http://127.0.0.1:8080/Test/Pass/123"));
    assertTrue(CastSource.needsBridge("http://31.43.191.125:8080/Test/Pass/123?x=1"));
    assertTrue(CastSource.needsBridge("http://neospaxy.top:8080/Test/Pass/57476"));
    assertTrue(CastSource.needsBridge("http://other.example/live/Test/Pass/123.ts"));
    assertFalse(CastSource.needsBridge("http://localhost/Test/Pass/123"));
    assertFalse(CastSource.needsBridge("http://192.168.1.1/Test/Pass/123"));
    assertFalse(CastSource.needsBridge(null));
  }

  @Test public void httpsTsAndM3u8ChannelsCanBeSentThroughTheHosting() {
    assertTrue(CastSource.castBridge("https://cdn.example/live/canal.ts"));
    assertTrue(CastSource.castBridge("http://31.43.191.125:8080/Test/Pass/123"));
    assertFalse(CastSource.castBridge("https://127.0.0.1/live/canal.ts"));
    assertFalse(CastSource.castBridge("https://cdn.example/canal.m3u8"));
    assertFalse(CastSource.needsBridge("https://cdn.example/live/canal.ts"));
    assertTrue(CastSource.list("http://iptv.example/live/canal.m3u8?token=1"));
    assertFalse(CastSource.list("https://cdn.example/canal.ts"));
    String relayed = Library.PLAYER_ENDPOINT + "?seg=aHR0cHM6Ly9h&p=aHR0cHM6Ly9i&sig=" + "a".repeat(32) + "&l=1";
    assertEquals("application/x-mpegURL", CastSource.contentType(relayed));
  }
}
