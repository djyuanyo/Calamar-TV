package es.yuanyo.calamartv;

import java.security.SecureRandom;
import java.util.List;

/**
 * The visitors' own 1X2 poll of a match, as web/votes.js: one vote per install and match, which can be
 * changed until kick-off. Firestore keeps only the match and the pick (calamarVotes, see
 * firebase/firestore.rules).
 */
final class Votes {
  private Votes() {}

  static final String PATH = "calamarVotes";
  static final long REFRESH_MS = 120000;

  /** The same match on the web and the app: «2026-10-30-villarreal-espanyol». */
  static String matchKey(String home, String away, String date) {
    String day = date == null || date.length() < 10 ? "" : date.substring(0, 10);
    String h = team(home), a = team(away);
    if (!day.matches("\\d{4}-\\d{2}-\\d{2}") || h.isEmpty() || a.isEmpty()) return "";
    return day + "-" + h + "-" + a;
  }

  private static String team(String name) {
    List<String> words = Polymarket.words(name);
    String joined = String.join("-", words);
    return joined.length() > 60 ? joined.substring(0, 60) : joined;
  }

  /** Voting closes at kick-off: before it the match is still «scheduled». */
  static boolean open(String state, long kickoff, long now) {
    return "scheduled".equals(state) && (kickoff == Long.MAX_VALUE || now < kickoff);
  }

  static String id(String voter, String match) { return voter + "_" + match; }

  /** Percentages of 1, X and 2 adding up to 100 (largest remainder), then the number of votes. */
  static long[] tally(long h, long d, long a) {
    long[] counts = {Math.max(0, h), Math.max(0, d), Math.max(0, a)};
    long total = counts[0] + counts[1] + counts[2];
    long[] out = new long[4];
    out[3] = total;
    if (total == 0) return out;
    double[] rest = new double[3];
    long sum = 0;
    for (int i = 0; i < 3; i++) { double v = counts[i] * 100.0 / total; out[i] = (long) Math.floor(v); rest[i] = v - out[i]; sum += out[i]; }
    while (sum < 100) {
      int top = 0;
      for (int i = 1; i < 3; i++) if (rest[i] > rest[top]) top = i;
      out[top]++; rest[top] = -1; sum++;
    }
    return out;
  }

  /** A random id kept by this install: it only tells its vote apart, it identifies nobody. */
  static String newVoter(SecureRandom random) {
    String letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    StringBuilder out = new StringBuilder();
    for (int i = 0; i < 24; i++) out.append(letters.charAt(random.nextInt(letters.length())));
    return out.toString();
  }
}
