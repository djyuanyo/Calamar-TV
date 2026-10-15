package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import org.junit.Test;

public class PlayerAddressTest {
  @Test
  public void officialPlayerIsOpenedAsFirstParty() {
    assertTrue(PlayerAddress.isOfficialPlayer("own", "https://bp.zicotv.cc/api/player/6"));
  }

  @Test
  public void tokenDoesNotChangeThePlayerIdentity() {
    assertTrue(
        PlayerAddress.isOfficialPlayer("own", "https://bp.zicotv.cc/api/player/6?token=example"));
  }

  @Test
  public void externalHostsAreNotTreatedAsOfficial() {
    assertFalse(
        PlayerAddress.isOfficialPlayer("own", "https://bp.zicotv.cc.example.org/api/player/6"));
    assertFalse(PlayerAddress.isOfficialPlayer("manual", "https://bp.zicotv.cc/api/player/6"));
    assertFalse(PlayerAddress.isOfficialPlayer("own", "http://bp.zicotv.cc/api/player/6"));
  }

  @Test
  public void officialComparisonPageHasNoClientToken() {
    assertEquals(
        "https://bp.zicotv.cc/channels/6",
        PlayerAddress.officialChannel("https://bp.zicotv.cc/api/player/6?token=example"));
  }
}
