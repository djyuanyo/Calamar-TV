package es.yuanyo.calamartv;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class ProviderPlayersTest {
  @Test public void normalizesOnlyKnownPlayerLinks() {
    String daily = "https://geo.dailymotion.com/player/x1k3pa.html?video=k5cyQ3rl70nCl7Fhb5W";
    assertEquals(daily, ProviderPlayers.embed(daily));
    assertEquals("https://www.dailymotion.com/embed/video/x84sh87", ProviderPlayers.embed("https://dai.ly/x84sh87"));
    assertNull(ProviderPlayers.embed("https://geo.dailymotion.com.evil.test/player/x1k3pa.html?video=x84sh87"));
    assertNull(ProviderPlayers.embed("https://u@vidara.to/v/KILxn38HjQjsv"));
    assertNull(ProviderPlayers.embed("https://vidara.so/v/KILxn38HjQjsv"));
    assertNull(ProviderPlayers.vidaraStream("https://u@vidara.to/v/KILxn38HjQjsv"));
    String stream = ProviderPlayers.vidaraStream("https://vidara.so/v/KILxn38HjQjsv");
    assertEquals("https://calamarmenciano.com/calamar-vidara.php?code=KILxn38HjQjsv&hls=1", stream);
    assertTrue(CastSource.onDemand(stream));
    assertEquals("application/x-mpegURL", CastSource.contentType(stream));
    assertTrue(Library.Media.allowed("https://vidara.to/v/KILxn38HjQjsv"));
  }
}
