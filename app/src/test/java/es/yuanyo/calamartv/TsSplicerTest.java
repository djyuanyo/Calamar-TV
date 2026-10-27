package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class TsSplicerTest {
  /** A 188-byte TS packet on PID 256 carrying a PCR (NaN for none); `tag` marks it. Keyframes start a unit. */
  static byte[] packet(double pcr, boolean key, int tag) { return packet(pcr, key, tag, 256, key); }

  static byte[] packet(double pcr, boolean key, int tag, int pid, boolean start) {
    byte[] p = new byte[188];
    p[0] = 0x47; p[1] = (byte) ((start ? 0x40 : 0) | (pid >> 8)); p[2] = (byte) pid; p[3] = 0x30;
    int flags = (Double.isNaN(pcr) ? 0 : 0x10) | (key ? 0x40 : 0);
    p[4] = (byte) (Double.isNaN(pcr) ? 1 : 7); p[5] = (byte) flags;
    if (!Double.isNaN(pcr)) {
      long base = (long) (pcr * 90000);
      p[6] = (byte) (base >> 25); p[7] = (byte) (base >> 17); p[8] = (byte) (base >> 9); p[9] = (byte) (base >> 1);
      p[10] = (byte) (((base & 1) << 7) | 0x7e);
    }
    for (int i = Double.isNaN(pcr) ? 6 : 12; i < 188; i++) p[i] = (byte) tag;
    return p;
  }

  private static List<Integer> tags(byte[] out) {
    List<Integer> t = new ArrayList<>();
    for (int i = 0; i + 188 <= out.length; i += 188) t.add(out[i + 187] & 0xff);
    return t;
  }

  /** Feeds each connection cut into chunks that split packets. */
  private static List<List<Integer>> splice(byte[][]... connections) {
    TsSplicer splicer = new TsSplicer();
    List<List<Integer>> out = new ArrayList<>();
    boolean first = true;
    for (byte[][] connection : connections) {
      if (!first) splicer.nextConnection();
      first = false;
      ByteArrayOutputStream all = new ByteArrayOutputStream(), got = new ByteArrayOutputStream();
      for (byte[] p : connection) all.write(p, 0, p.length);
      byte[] data = all.toByteArray();
      for (int i = 0; i < data.length; i += 1000) {
        byte[] piece = splicer.feed(data, i, Math.min(1000, data.length - i));
        got.write(piece, 0, piece.length);
      }
      out.add(tags(got.toByteArray()));
    }
    return out;
  }

  private static final double N = Double.NaN;

  @Test public void aRepeatedWindowResumesAtAKeyframeAfterTheLastMomentPassedOn() {
    byte[][] first = {packet(10, true, 1), packet(N, false, 2), packet(11, false, 3), packet(11.5, false, 4), packet(N, true, 5), packet(12, false, 6)};
    byte[][] second = {packet(10, true, 7), packet(11, false, 8), packet(N, true, 9), packet(12, false, 10), packet(12.5, false, 11),
        packet(N, true, 12), packet(13, false, 13), packet(N, true, 14)};
    assertEquals("[[1, 2, 3, 4], [12, 13]]", splice(first, second).toString());
  }

  @Test public void otherStreamsJoinAtTheirUnitStartAndAConnectionWithNothingNewPassesNothing() {
    byte[][] data = {packet(1, false, 1), packet(N, false, 2, 257, false), packet(N, true, 3), packet(N, false, 4, 257, false),
        packet(N, false, 5, 257, true), packet(2, false, 6), packet(N, true, 7)};
    assertEquals("[[3, 5, 6]]", splice(data).toString());
    byte[][] a = {packet(10, true, 1), packet(20, true, 2), packet(N, true, 3)};
    byte[][] b = {packet(10, true, 4), packet(15, true, 5)};
    byte[][] c = {packet(18, true, 6), packet(21, true, 7), packet(22, true, 8)};
    assertEquals("[[1, 2], [], [7]]", splice(a, b, c).toString());
  }

  @Test public void aRestartedChannelClockResumesAtOnce() {
    byte[][] first = {packet(5000, true, 1), packet(N, true, 2)};
    byte[][] second = {packet(N, false, 3), packet(3, true, 4), packet(4, false, 5), packet(N, true, 6)};
    assertEquals("[[1], [4, 5]]", splice(first, second).toString());
  }
}
