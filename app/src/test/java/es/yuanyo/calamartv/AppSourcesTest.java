package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.*;
import org.junit.Test;
public class AppSourcesTest {
 @Test public void zicoAndDirectIptvRemainAvailableWithoutDuplicates() {
  List<String> links = Arrays.asList("https://bp.zicotv.cc/events/98019", "https://bp.zicotv.cc/api/player/22", "https://cdn.zicotv.cc/live.m3u8", "http://provider.example/user/pass/265");
  // ZicoTV's links go last: the direct IPTV link first.
  assertEquals(Arrays.asList(links.get(3), links.get(0), links.get(1), links.get(2)), AppSources.forAndroid(links));
  assertEquals(Arrays.asList("https://iptv.example/live/canal.m3u8", "https://bp.zicotv.cc/api/player/22"),
      AppSources.forAndroid(Arrays.asList("https://bp.zicotv.cc/api/player/22", "https://iptv.example/live/canal.m3u8")));
  assertEquals(Collections.singletonList(links.get(0)), AppSources.forAndroid(Arrays.asList(links.get(0),links.get(0),"invalid")));
 }
}
