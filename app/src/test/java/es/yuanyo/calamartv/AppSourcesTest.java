package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.*;
import org.junit.Test;
public class AppSourcesTest {
 @Test public void zicoAndDirectIptvRemainAvailableWithoutDuplicates() {
  List<String> links = Arrays.asList("https://bp.zicotv.cc/events/98019", "https://bp.zicotv.cc/api/player/22", "https://cdn.zicotv.cc/live.m3u8", "http://provider.example/user/pass/265");
  assertEquals(links, AppSources.forAndroid(links));
  assertEquals(Collections.singletonList(links.get(0)), AppSources.forAndroid(Arrays.asList(links.get(0),links.get(0),"invalid")));
 }
}
