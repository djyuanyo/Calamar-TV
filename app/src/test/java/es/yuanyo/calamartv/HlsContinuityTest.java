package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import org.junit.Test;
import okio.ByteString;
public class HlsContinuityTest {
  private String signed(String path,String token) {
    return Library.PLAYER_ENDPOINT+"?seg="+ByteString.encodeUtf8("https://cdn.example/"+path+"?token="+token).base64Url()+"&sig="+token;
  }
  @Test public void updatesPlaylistsWithoutChangingSegmentsOrTrustBoundary() {
    String old=signed("index.m3u8","old"),fresh=signed("index.m3u8","fresh"),video=signed("video.m3u8","fresh"),audio=signed("audio.m3u8","fresh");
    HlsContinuity session=new HlsContinuity(old);
    assertTrue(session.update(fresh,"#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\""+audio+"\"\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n"+video+"\n"));
    assertEquals(fresh,session.resolve(old));
    assertEquals(video,session.resolve(signed("video.m3u8","old")));
    assertEquals(audio,session.resolve(signed("audio.m3u8","old")));
    assertEquals(signed("part.ts","old"),session.resolve(signed("part.ts","old")));
    assertFalse(session.update(fresh.replace("calamarmenciano.com","evil.test"),"#EXTM3U\n"));
    assertFalse(session.update(signed("other-channel.m3u8","fresh"),"#EXTM3U\n"));
    assertFalse(session.update(fresh,"<html>Error</html>"));
    assertEquals(fresh,session.resolve(old));
  }
}
