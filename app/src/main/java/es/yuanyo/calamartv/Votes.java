package es.yuanyo.calamartv;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.List;
import org.json.JSONObject;

/**
 * The visitors' own 1X2 poll of a match, as web/votes.js: one vote per install and match, which can be
 * changed until the match ends. The hosting keeps only the match and the pick (hosting/calamar-votes.php).
 */
final class Votes {
  private Votes() {}

  static final String ENDPOINT = "https://calamarmenciano.com/calamar-votes.php";
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

  /** Voting stays open before and during the match, and closes when it ends (or is called off). */
  static boolean open(String state) {
    return "scheduled".equals(state) || "live".equals(state) || "halftime".equals(state);
  }

  /** The hosting said no (too many votes, a closed match…), with its reason in Spanish. */
  static final class Refused extends Exception { Refused(String message) { super(message); } }

  static String body(String match, String voter, String pick) throws Exception {
    return new JSONObject().put("match", match).put("voter", voter).put("pick", pick).toString();
  }

  /** The votes of a match as {1, X, 2} from the hosting's answer {"h":…,"d":…,"a":…}. */
  static long[] totals(JSONObject answer) {
    return new long[] {Math.max(0, answer.optLong("h")), Math.max(0, answer.optLong("d")), Math.max(0, answer.optLong("a"))};
  }

  /** Blocking: a GET, or a POST of the vote when body is not null. */
  static JSONObject request(String url, String body) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(8000); c.setReadTimeout(15000);
    try {
      if (body != null) {
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "text/plain; charset=utf-8");
        try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
      }
      int code = c.getResponseCode();
      InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
      JSONObject answer = new JSONObject(in == null ? "{}" : new String(MatchCenter.readAll(in), StandardCharsets.UTF_8));
      if (code != 200) throw new Refused(answer.optString("error", "No se ha podido guardar el voto. Inténtalo de nuevo."));
      return answer;
    } finally { c.disconnect(); }
  }

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
