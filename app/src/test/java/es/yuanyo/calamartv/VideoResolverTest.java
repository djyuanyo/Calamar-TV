package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.util.List;
import org.junit.Test;

public class VideoResolverTest {
  @Test
  public void readsEscapedSourceAndSkipsLockedPremium() throws Exception {
    String html =
        "var ZT_SOURCES = [{\"label\":\"CDN ]"
            + " 1\",\"url\":\"https:\\/\\/cdn.example\\/live.m3u8?token=abc\"},{\"url\":\"https://cdn.example/premium.m3u8\",\"locked\":true}];";
    List<VideoResolver.Source> sources = VideoResolver.parse(html, "https://example.com/player");
    assertEquals(1, sources.size());
    assertEquals("CDN ] 1", sources.get(0).label);
    assertEquals("https://cdn.example/live.m3u8?token=abc", sources.get(0).url);
  }

  @Test
  public void emptyListDoesNotLeakLockedUrlElsewhere() throws Exception {
    assertTrue(
        VideoResolver.parse(
                "var ZT_SOURCES=[]; var locked='https://cdn.example/private.m3u8';",
                "https://example.com")
            .isEmpty());
  }

  @Test
  public void readsRelativeHtmlVideoAndDeduplicates() throws Exception {
    List<VideoResolver.Source> result =
        VideoResolver.parse(
            "<video src='/live.m3u8?a=1&amp;b=2'><source src='/live.m3u8?a=1&amp;b=2'>",
            "https://example.com/player");
    assertEquals(1, result.size());
    assertEquals("https://example.com/live.m3u8?a=1&b=2", result.get(0).url);
  }

  @Test
  public void rejectsNonMediaAndUnsafeSchemes() {
    assertFalse(VideoResolver.isMedia("https://example.com/player/6"));
    assertFalse(VideoResolver.isMedia("http://example.com/a.m3u8"));
    assertFalse(VideoResolver.isMedia("file:///a.m3u8"));
    assertFalse(VideoResolver.isMedia("https://user:pass@example.com/a.m3u8"));
    assertTrue(VideoResolver.isMedia("https://example.com/a.M3U8?token=1"));
  }

  @Test(expected = IllegalArgumentException.class)
  public void rejectsTruncatedSourceList() throws Exception {
    VideoResolver.parse("var ZT_SOURCES=[{\"url\":\"a\"}", "https://example.com");
  }

  @Test
  public void extractsExpiryHintAndSchedulesBeforeExpiry() {
    String url = "https://cdn.example/a.m3u8?token=aaa-bbb-1792066111-";
    assertEquals(1792066111000L, VideoResolver.expiryMillis(url));
    assertEquals(30000, VideoResolver.renewalDelay(url, 1792066051000L));
    assertEquals(-1, VideoResolver.renewalDelay(url, 1792066111001L));
  }

  @Test
  public void handlesExpiryParameterAndUnrecognizedToken() {
    assertEquals(
        1792066111000L, VideoResolver.expiryMillis("https://cdn.example/a.m3u8?e=1792066111"));
    assertEquals(-1, VideoResolver.expiryMillis("https://cdn.example/a.m3u8?token=opaque"));
  }

  @Test
  public void neverTreatsIframeUrlAsDirectVideo() throws Exception {
    assertTrue(
        VideoResolver.parse(
                "<iframe src='https://example.com/embed/6'></iframe>", "https://example.com")
            .isEmpty());
  }

  @Test
  public void readsJwPlayerSourcesInsidePackedJavaScript() throws Exception {
    String html = "<html><script>eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+c.toString(a)+'\\\\b','g'),k[c]);return p}('0(\"1\").2({3:[{4:\"5://6.7.8/9/a/b/c.d?e=f&g=h\"}],i:\"5://j.7.8/b.k\"});',36,21,'jwplayer|vplayer|setup|sources|file|https|cdn|example|net|hls2|01|abc|master|m3u8|t|xyz|e|10800|image|img|jpg'.split('|')))</script></html>";
    List<VideoResolver.Source> sources = VideoResolver.parse(html, "https://lulustream.com/e/abcd1234efgh");
    assertEquals(1, sources.size());
    assertEquals("https://cdn.example.net/hls2/01/abc/master.m3u8?t=xyz&e=10800", sources.get(0).url);
  }

  @Test
  public void readsPlainJwPlayerSources() throws Exception {
    List<VideoResolver.Source> sources =
        VideoResolver.parse("<script>p.setup({sources:[{file:'https:\\/\\/cdn.example.net\\/v.m3u8'}],image:'https://x/y.jpg'})</script>", "https://lulustream.com/e/abcd1234efgh");
    assertEquals(1, sources.size());
    assertEquals("https://cdn.example.net/v.m3u8", sources.get(0).url);
  }

  @Test
  public void aVideoStillBeingConvertedIsRecognised() throws Exception {
    String page = "<div class=\"processing\">Video is processing now.<br>Conversion stage: Pending in queue #3</div>";
    assertTrue(VideoResolver.processing(page));
    assertTrue(VideoResolver.parse(page, "https://lulustream.com/e/abcd1234efgh").isEmpty());
    assertFalse(VideoResolver.processing("<script>p.setup({sources:[{file:'https://cdn.example.net/v.m3u8'}]})</script>"));
  }
}
