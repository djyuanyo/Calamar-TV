package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import org.junit.Test;

public class MultiScreenTest {
  @Test public void twoTopAndBottomMoreInAGrid() {
    int[][] expected = {{1, 1}, {2, 1}, {2, 2}, {2, 2}, {2, 3}, {2, 3}};
    for (int n = 1; n <= 6; n++) assertArrayEquals("n=" + n, expected[n - 1], MultiScreen.grid(n));
    assertFalse(MultiScreen.landscape(2));
    assertTrue(MultiScreen.landscape(3));
  }
}
