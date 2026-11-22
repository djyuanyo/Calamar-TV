package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.*;
import org.junit.Test;
public class AppSourcesTest {
 @Test public void recognizesOnlyRegisteredPlaylistsAndKeepsDirectTsAsMedia() {
  String key = "0123456789abcdef0123456789abcdef";
  assertEquals(key, IptvOriginal.key("https://video.calamarmenciano.com/iptv-hls/" + key + "/index.m3u8"));
  assertNull(IptvOriginal.key("https://example.com/iptv-hls/" + key + "/index.m3u8"));
  assertTrue(IptvOriginal.playableSignal("http://provider.example:8080/user/pass/265"));
  assertTrue(IptvOriginal.playableSignal("https://provider.example/live/user/pass/265"));
  assertFalse(UserChannels.isPage("https://provider.example:8080/user/pass/265"));
  assertTrue(UserChannels.isPage("https://bp.zicotv.cc/api/player/4"));
 }
 @Test public void zicoAndDirectIptvRemainAvailableWithoutDuplicates() {
  List<String> links = Arrays.asList("https://bp.zicotv.cc/events/98019", "https://bp.zicotv.cc/api/player/22", "https://cdn.zicotv.cc/live.m3u8", "http://provider.example/user/pass/265");
  // ZicoTV's links go last: the direct IPTV link first.
  assertEquals(Arrays.asList(links.get(3), links.get(0), links.get(1), links.get(2)), AppSources.forAndroid(links));
  assertEquals(Arrays.asList("https://iptv.example/live/canal.m3u8", "https://bp.zicotv.cc/api/player/22"),
      AppSources.forAndroid(Arrays.asList("https://bp.zicotv.cc/api/player/22", "https://iptv.example/live/canal.m3u8")));
  assertEquals(Collections.singletonList(links.get(0)), AppSources.forAndroid(Arrays.asList(links.get(0),links.get(0),"invalid")));
 }
}
