package es.yuanyo.calamartv;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class ProviderPlayersTest {
  @Test public void publicZicoEmbedIsLimitedToChannelIds() {
    String host = "https://zicotv.gcorecdn.com";
    String page = SportsCatalog.WEB + "zico-player.html#4";
    assertEquals(page, ProviderPlayers.zicoFramePage(host + "/api/player/4"));
    assertEquals(page, ProviderPlayers.zicoFramePage(host + "/channels/4"));
    for (String address : new String[]{host + "/events/4", host + "/live.m3u8",
        host + ".example/api/player/4", host + ":444/api/player/4", host + "/api/player/4/more"})
      assertNull(ProviderPlayers.zicoFramePage(address));
  }

  @Test public void premiumZicoFramesUseTheOfficialChannelAndEventOnly() {
    String wrapper = SportsCatalog.WEB + "zico-player.html#premium/6";
    assertEquals(wrapper, ProviderPlayers.zicoFramePage("https://bp.zicotv.cc/channels/6?token=private"));
    assertEquals(wrapper + "?event=701", ProviderPlayers.zicoFramePage(
        "https://zicotv.cc/api/player/6", "https://bp.zicotv.cc/events/701"));
    String proof = "ct_event=700&ct_sig=1234567890abcdef1234567890abcdef";
    assertEquals(wrapper + "?" + proof, ProviderPlayers.zicoFramePage("https://bp.zicotv.cc/api/player/6?" + proof));
    assertEquals(wrapper, ProviderPlayers.zicoFramePage("https://bp.zicotv.cc/api/player/6", "https://example.com/events/701"));
    assertNull(ProviderPlayers.zicoFramePage("https://bp.zicotv.cc.example.com/api/player/6"));
  }

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

  @Test public void acceptsVidaraaLibraryLinksWithUrlSafeCodes() {
    String share = "https://vidaraa.cc/v/Ab_12-xyz567";
    assertTrue(Library.Media.allowed(share));
    String playback = ProviderPlayers.vidaraStream(share);
    assertEquals("https://calamarmenciano.com/calamar-vidara.php?code=Ab_12-xyz567&hls=1", playback);
    assertTrue(ProviderPlayers.isVidaraStream(playback));
    assertNull(ProviderPlayers.vidaraStream(share.replace("vidaraa.cc", "vidaraa.cc.example.com")));
  }
}
