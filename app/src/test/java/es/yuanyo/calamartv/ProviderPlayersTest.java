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
    assertEquals("https://vidara.to/e/KILxn38HjQjsv", ProviderPlayers.embed("https://vidara.so/v/KILxn38HjQjsv"));
    assertTrue(Library.Media.allowed("https://vidara.to/v/KILxn38HjQjsv"));
  }
}
