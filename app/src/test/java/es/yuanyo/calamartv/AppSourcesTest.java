package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import java.util.*;
import org.junit.Test;

public class AppSourcesTest {
  @Test public void removesZicoPagesAndCdnLinksWithoutChangingTheSharedCatalog() {
    List<String> catalog = Arrays.asList("https://zicotv.cc/api/player/28", "https://bp.zicotv.cc/api/player/4",
        "https://CDN4.ZICOTV.CC/live/index.m3u8?token=old", "http://cdn.zicotv.cc/a.ts",
        "https://other.example/channel", "http://iptv.example:8080/live.ts");
    assertEquals(Arrays.asList(catalog.get(4), catalog.get(5)), AppSources.forAndroid(catalog));
    assertEquals(6, catalog.size());
  }
  @Test public void matchesTheHostOnlyAndKeepsAlternativeOrder() {
    List<String> catalog = Arrays.asList("https://zicotv.cc.example/a.m3u8", "https://example.org/zicotv.cc/a.m3u8",
        "https://bp.zicotv.cc/channel", "https://example.org/zicotv.cc/a.m3u8");
    assertEquals(catalog.subList(0, 2), AppSources.forAndroid(catalog));
    assertTrue(AppSources.forAndroid(Arrays.asList("https://zicotv.cc/a", "not a url")).isEmpty());
    assertFalse(AppSources.webOnly(null));
  }
}
