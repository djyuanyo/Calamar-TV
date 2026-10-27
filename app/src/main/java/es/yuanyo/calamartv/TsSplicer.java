package es.yuanyo.calamartv;

import java.io.ByteArrayOutputStream;
import java.util.HashSet;
import java.util.Set;

/**
 * Joins the connections of an HTTP IPTV channel into one continuous MPEG-TS, as tsSplice in the
 * hosting's calamar-tv-relay.php. These providers close each connection after a while and every new
 * one starts again with the last ~40 s they keep: played as it comes, the picture goes back in time
 * and stutters. Only whole stretches from a video keyframe are passed on (what came after the last
 * keyframe waits for the next one, and is dropped if the connection ends first); a new connection
 * resumes at the first keyframe after the last PCR clock passed on, and every other stream at its
 * next unit start. A clock far away (the channel restarted) resumes at once.
 */
final class TsSplicer {
  private static final int PACKET = 188;
  private static final int HOLD_LIMIT = 8 << 20;
  private static final int[] VIDEO_TYPES = {0x01, 0x02, 0x10, 0x1b, 0x24, 0x42, 0xd1, 0xea};

  private double pcr = Double.NaN, seen = Double.NaN;
  private int video = -1, pmtPid = -1;
  private boolean skip = true, ahead = true;
  private byte[] carry = new byte[0];
  private final ByteArrayOutputStream hold = new ByteArrayOutputStream();
  private final Set<Integer> started = new HashSet<>();

  /** The provider closed the connection and a new one starts: it repeats what was already passed on. */
  void nextConnection() {
    skip = true;
    ahead = Double.isNaN(pcr);
    seen = pcr;
    carry = new byte[0];
    hold.reset();
    started.clear();
  }

  /** The part of these bytes to pass on (possibly empty). */
  byte[] feed(byte[] data, int offset, int length) {
    byte[] all = new byte[carry.length + length];
    System.arraycopy(carry, 0, all, 0, carry.length);
    System.arraycopy(data, offset, all, carry.length, length);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    int i = 0;
    while (i + PACKET <= all.length) {
      if ((all[i] & 0xff) != 0x47) { i++; continue; }
      int at = i;
      i += PACKET;
      int pid = ((all[at + 1] & 0x1f) << 8) | (all[at + 2] & 0xff);
      boolean unit = (all[at + 1] & 0x40) != 0;
      double clock = pcr(all, at);
      if (unit && (pid == 0 || pid == pmtPid)) table(all, at, pid);
      // Without a PMT naming it, the video is the stream carrying the clock.
      if (!Double.isNaN(clock) && video < 0) video = pid;
      boolean key = pid == video && unit && keyframe(all, at);
      if (skip) {
        if (!Double.isNaN(clock) && (Double.isNaN(pcr) || clock > pcr || Math.abs(clock - pcr) > 120)) ahead = true;
        if (!ahead || !key) { if (!Double.isNaN(clock) && ahead) seen = clock; continue; }
        skip = false;
        started.clear();
        started.add(pid);
      }
      if (!started.contains(pid)) {
        if (!unit) continue; // Another stream joins at its next unit, never halfway.
        started.add(pid);
      }
      if (key) {
        writeTo(hold, out);
        hold.reset();
        pcr = seen;
      }
      if (!Double.isNaN(clock)) seen = clock;
      hold.write(all, at, PACKET);
      // A video with no keyframes marked is passed on anyway, a few megabytes at a time.
      if (hold.size() > HOLD_LIMIT) { writeTo(hold, out); hold.reset(); pcr = seen; }
    }
    carry = java.util.Arrays.copyOfRange(all, Math.min(i, all.length), all.length);
    return out.toByteArray();
  }

  private static void writeTo(ByteArrayOutputStream from, ByteArrayOutputStream to) {
    byte[] bytes = from.toByteArray();
    to.write(bytes, 0, bytes.length);
  }

  /** The PCR clock of a packet in seconds, or NaN. */
  static double pcr(byte[] p, int at) {
    if ((p[at + 3] & 0x20) == 0 || (p[at + 4] & 0xff) < 7 || (p[at + 5] & 0x10) == 0) return Double.NaN;
    long base = ((long) (p[at + 6] & 0xff) << 25) | ((p[at + 7] & 0xff) << 17) | ((p[at + 8] & 0xff) << 9)
        | ((p[at + 9] & 0xff) << 1) | ((p[at + 10] & 0xff) >> 7);
    return base / 90000.0;
  }

  /** Whether a packet starts a picture a decoder can begin with (random access indicator). */
  static boolean keyframe(byte[] p, int at) {
    return (p[at + 3] & 0x20) != 0 && (p[at + 4] & 0xff) > 0 && (p[at + 5] & 0x40) != 0;
  }

  /** PAT: where the PMT is. PMT: which stream is the video. */
  private void table(byte[] p, int at, int pid) {
    int pos = at + 4;
    if ((p[at + 3] & 0x20) != 0) pos += 1 + (p[at + 4] & 0xff);
    if (pos >= at + PACKET) return;
    pos += 1 + (p[pos] & 0xff);
    if (pos + 3 > at + PACKET) return;
    int id = p[pos] & 0xff;
    int end = Math.min(at + PACKET, pos + 3 + (((p[pos + 1] & 0x0f) << 8) | (p[pos + 2] & 0xff))) - 4;
    if (id == 0x00 && pid == 0 && pos + 12 <= at + PACKET) {
      pmtPid = ((p[pos + 10] & 0x1f) << 8) | (p[pos + 11] & 0xff);
    } else if (id == 0x02 && pos + 12 <= at + PACKET) {
      int s = pos + 12 + (((p[pos + 10] & 0x0f) << 8) | (p[pos + 11] & 0xff));
      while (s + 5 <= end) {
        int type = p[s] & 0xff, es = ((p[s + 1] & 0x1f) << 8) | (p[s + 2] & 0xff);
        for (int v : VIDEO_TYPES) if (type == v) { video = es; return; }
        s += 5 + (((p[s + 3] & 0x0f) << 8) | (p[s + 4] & 0xff));
      }
    }
  }
}
