package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import org.junit.Test;
public class DailymotionPlayerTest {
  @Test public void officialConfiguredPlayerIsPreserved(){
    String u="https://geo.dailymotion.com/player/x1k3pa.html?video=k5cyQ3rl70nCl7Fhb5W";
    assertEquals(u,DailymotionPlayer.embed(u));
    for(String bad:new String[]{u.replace("https:","http:"),u.replace("geo.dailymotion.com","geo.dailymotion.com.evil.example"),u.replace("video=","missing="),u+"#fragment",u.replace("https://","https://user:pass@")})assertNull(DailymotionPlayer.embed(bad));
  }
}
