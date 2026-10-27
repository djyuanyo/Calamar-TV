package es.yuanyo.calamartv;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.security.SecureRandom;
import org.junit.Test;

public class VotesTest {
  @Test public void sameKeyAsTheWeb() {
    assertEquals("2026-10-30-villarreal-espanyol", Votes.matchKey("Villarreal CF", "RCD Espanyol", "2026-10-30T20:00Z"));
    assertEquals("2026-10-31-atletico-madrid-real-betis", Votes.matchKey("Atlético Madrid", "Real Betis", "2026-10-31T13:00:00Z"));
    assertEquals("", Votes.matchKey("Villarreal", "", "2026-10-30T20:00Z"));
    assertEquals("", Votes.matchKey("Villarreal", "Espanyol", ""));
  }

  @Test public void openUntilKickOff() {
    assertTrue(Votes.open("scheduled", 2000, 1000));
    assertFalse(Votes.open("scheduled", 2000, 3000));
    assertFalse(Votes.open("live", 2000, 1000));
    assertTrue(Votes.open("scheduled", Long.MAX_VALUE, 3000));
  }

  @Test public void totalsAddUpToOneHundred() {
    assertArrayEquals(new long[] {34, 33, 33, 3}, Votes.tally(1, 1, 1));
    assertArrayEquals(new long[] {0, 0, 0, 0}, Votes.tally(0, 0, 0));
    assertArrayEquals(new long[] {75, 0, 25, 4}, Votes.tally(3, 0, 1));
  }

  @Test public void voterIdsLookLikeTheWebOnes() {
    String voter = Votes.newVoter(new SecureRandom());
    assertTrue(voter.matches("[A-Za-z0-9]{24}"));
    assertEquals(voter + "_2026-10-30-a-b", Votes.id(voter, "2026-10-30-a-b"));
  }
}
