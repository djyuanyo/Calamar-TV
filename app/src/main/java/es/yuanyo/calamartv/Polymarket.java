package es.yuanyo.calamartv;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What Polymarket's market expects of a match (home win, draw, away win), from its public API, as
 * web/polymarket.js. Only read: nothing is bet from the app. The match is found by its kick-off
 * (Polymarket's football events end at kick-off) and its teams.
 */
final class Polymarket {
  private Polymarket() {}

  static final String API = "https://gamma-api.polymarket.com/events";
  private static final Set<String> COMMON = new HashSet<>(Arrays.asList("fc", "cf", "cd", "ud", "sd", "ac", "as", "afc", "sc", "ss", "ssc",
      "club", "de", "del", "la", "el", "the", "calcio", "football", "futbol", "sad", "cp", "rc", "rcd", "sv", "vfb", "vfl", "fk", "sk", "if", "bk"));
  private static final Set<String> WEAK = new HashSet<>(Arrays.asList("real", "atletico", "sporting", "united", "city", "inter", "athletic", "racing", "deportivo"));

  static final class Odds {
    int home, draw, away;
    double volume;
    String url = "", slug = "";
    String[] tokens = {"", "", ""};
    /** Goals markets in % («+1,5 goles», «Ambos marcan»…), and how the chances moved: {seconds, %} per side. */
    final List<String> goalLabels = new ArrayList<>();
    final List<Integer> goalPcts = new ArrayList<>();
    double[][][] history;
  }

  static List<String> words(String name) {
    String plain = Normalizer.normalize(name == null ? "" : name.toLowerCase(Locale.ROOT), Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    List<String> out = new ArrayList<>();
    for (String w : plain.split("[^a-z0-9]+")) if (!w.isEmpty() && !COMMON.contains(w)) out.add(w);
    return out;
  }

  /** How well two team names match: 0 none, more is better. «Real» alone is not a match. */
  static int teamScore(String a, String b) {
    List<String> x = words(a), y = words(b);
    if (x.isEmpty() || y.isEmpty()) return 0;
    if (String.join(" ", x).equals(String.join(" ", y))) return 10;
    List<String> shared = new ArrayList<>();
    for (String w : x) if (y.contains(w)) shared.add(w);
    int score = shared.size();
    String jx = String.join("", x), jy = String.join("", y);
    if (jx.length() > 3 && jy.length() > 3 && (jx.contains(jy) || jy.contains(jx))) score += 2;
    if (shared.size() == 1 && score == 1 && WEAK.contains(shared.get(0))) return 0;
    return score;
  }

  private static JSONObject team(JSONObject event, String ordering, int fallback) {
    JSONArray teams = event.optJSONArray("teams");
    if (teams == null) return null;
    for (int i = 0; i < teams.length(); i++) {
      JSONObject t = teams.optJSONObject(i);
      if (t != null && ordering.equals(t.optString("ordering"))) return t;
    }
    return teams.optJSONObject(fallback);
  }

  private static int best(JSONObject team, String name) {
    return team == null ? 0 : Math.max(teamScore(name, team.optString("name")), teamScore(name, team.optString("alias")));
  }

  private static boolean moneyline(JSONObject m) { return m != null && "moneyline".equals(m.optString("sportsMarketType")); }

  /** The match's odds from a Polymarket event, adding up to 100 (home and away as Polymarket has them), or null. */
  static Odds eventOdds(JSONObject event) {
    JSONArray markets = event.optJSONArray("markets");
    JSONObject home = team(event, "home", 0), away = team(event, "away", 1);
    if (markets == null || home == null || away == null) return null;
    JSONObject draw = null, homeMarket = null, awayMarket = null;
    double volume = 0;
    for (int i = 0; i < markets.length(); i++) {
      JSONObject m = markets.optJSONObject(i);
      if (!moneyline(m) || m.optBoolean("closed")) continue;
      volume += m.optDouble("volume", 0);
      String title = m.optString("groupItemTitle", m.optString("question"));
      if (title.toLowerCase(Locale.ROOT).contains("draw")) draw = m;
      else if (title.equals(home.optString("name")) || teamScore(title, home.optString("name")) >= 2) homeMarket = m;
      else if (title.equals(away.optString("name")) || teamScore(title, away.optString("name")) >= 2) awayMarket = m;
    }
    if (draw == null || homeMarket == null || awayMarket == null) return null;
    double[] raw = {yes(homeMarket), yes(draw), yes(awayMarket)};
    double total = raw[0] + raw[1] + raw[2];
    for (double p : raw) if (!(p >= 0)) return null;
    if (!(total > 0)) return null;
    // Rounded so the three add up to exactly 100.
    int[] pct = new int[3];
    double[] rest = new double[3];
    int sum = 0;
    for (int i = 0; i < 3; i++) { double v = raw[i] / total * 100; pct[i] = (int) Math.floor(v); rest[i] = v - pct[i]; sum += pct[i]; }
    while (sum < 100) {
      int top = 0;
      for (int i = 1; i < 3; i++) if (rest[i] > rest[top]) top = i;
      pct[top]++; rest[top] = -1; sum++;
    }
    Odds o = new Odds();
    o.home = pct[0]; o.draw = pct[1]; o.away = pct[2]; o.volume = volume;
    o.slug = event.optString("slug");
    o.url = "https://polymarket.com/event/" + o.slug;
    o.tokens = new String[] {token(homeMarket), token(draw), token(awayMarket)};
    return o;
  }

  private static String token(JSONObject market) {
    try { return new JSONArray(market.optString("clobTokenIds")).optString(0); }
    catch (Exception broken) { return ""; }
  }

  private static double yes(JSONObject market) {
    try { return Double.parseDouble(new JSONArray(market.optString("outcomePrices")).optString(0)); }
    catch (Exception broken) { return Double.NaN; }
  }

  /** Among the events around kick-off, the odds of this match in our order (teams may come swapped), or null. */
  static Odds pick(JSONArray events, String home, String away) {
    JSONObject bestEvent = null;
    double bestScore = 0;
    boolean swapped = false;
    for (int i = 0; events != null && i < events.length(); i++) {
      JSONObject e = events.optJSONObject(i);
      if (e == null || e.optString("title").contains(" - ")) continue;
      JSONArray markets = e.optJSONArray("markets");
      boolean any = false;
      for (int j = 0; markets != null && j < markets.length(); j++) if (moneyline(markets.optJSONObject(j))) any = true;
      if (!any) continue;
      JSONObject h = team(e, "home", 0), a = team(e, "away", 1);
      if (h == null || a == null) continue;
      int same = Math.min(best(h, home), best(a, away)), turned = Math.min(best(h, away), best(a, home));
      double score = Math.max(same, turned > 0 ? turned - 0.5 : 0);
      if (score > bestScore) { bestScore = score; bestEvent = e; swapped = turned > same; }
    }
    Odds o = bestEvent == null ? null : eventOdds(bestEvent);
    if (o != null && swapped) { int h = o.home; o.home = o.away; o.away = h; String t = o.tokens[0]; o.tokens[0] = o.tokens[2]; o.tokens[2] = t; }
    return o;
  }

  static String iso(long ms) {
    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
    f.setTimeZone(TimeZone.getTimeZone("UTC"));
    return f.format(new Date(ms));
  }

  static final long WINDOW_MS = 45 * 60000L;
  static final int PAGE_SIZE = 100, PAGES = 4;

  /** The address of one page of the football events ending within 45 minutes of kick-off. */
  static String query(long kickoff, int page) throws Exception {
    return API + "?tag_id=100350&closed=false&limit=" + PAGE_SIZE + "&offset=" + page * PAGE_SIZE
        + "&end_date_min=" + URLEncoder.encode(iso(kickoff - WINDOW_MS), "UTF-8")
        + "&end_date_max=" + URLEncoder.encode(iso(kickoff + WINDOW_MS), "UTF-8");
  }

  /** Blocking: call it off the main thread. On a busy hour a few pages are read. */
  static Odds fetch(String home, String away, long kickoff) throws Exception {
    for (int page = 0; page < PAGES; page++) {
      HttpURLConnection c = (HttpURLConnection) new URL(query(kickoff, page)).openConnection();
      c.setConnectTimeout(8000); c.setReadTimeout(15000);
      JSONArray events;
      try {
        if (c.getResponseCode() != 200) return null;
        try (InputStream in = c.getInputStream()) { events = new JSONArray(new String(MatchCenter.readAll(in), "UTF-8")); }
      } finally { c.disconnect(); }
      Odds odds = pick(events, home, away);
      if (odds != null) return odds;
      if (events.length() < PAGE_SIZE) return null;
    }
    return null;
  }

  static final String CLOB = "https://clob.polymarket.com/prices-history";
  private static final double[] GOAL_LINES = {1.5, 2.5, 3.5};
  private static final String[] GOAL_NAMES = {"+1,5 goles", "+2,5 goles", "+3,5 goles"};

  /** Over 1.5, 2.5 and 3.5 goals and both teams scoring, in %, from the match's «More Markets» event. */
  static void goals(JSONObject event, Odds o) {
    JSONArray markets = event == null ? null : event.optJSONArray("markets");
    if (markets == null) return;
    for (int g = 0; g < GOAL_LINES.length; g++) {
      for (int i = 0; i < markets.length(); i++) {
        JSONObject m = markets.optJSONObject(i);
        if (m == null || m.optBoolean("closed") || !"totals".equals(m.optString("sportsMarketType")) || m.optDouble("line", -1) != GOAL_LINES[g]) continue;
        double p = yes(m);
        if (p >= 0) { o.goalLabels.add(GOAL_NAMES[g]); o.goalPcts.add((int) Math.round(p * 100)); }
        break;
      }
    }
    for (int i = 0; i < markets.length(); i++) {
      JSONObject m = markets.optJSONObject(i);
      if (m == null || m.optBoolean("closed") || !"both_teams_to_score".equals(m.optString("sportsMarketType"))) continue;
      double p = yes(m);
      if (p >= 0) { o.goalLabels.add("Ambos marcan"); o.goalPcts.add((int) Math.round(p * 100)); }
      break;
    }
  }

  /** One side's points from the order book's answer {"history":[{"t":seconds,"p":0.62}]}, as {seconds, %}. */
  static double[][] series(JSONObject answer) {
    JSONArray h = answer == null ? null : answer.optJSONArray("history");
    if (h == null) return new double[0][];
    List<double[]> out = new ArrayList<>();
    for (int i = 0; i < h.length(); i++) {
      JSONObject p = h.optJSONObject(i);
      if (p != null && p.has("t") && p.has("p")) out.add(new double[] {p.optDouble("t"), Math.round(p.optDouble("p") * 1000) / 10.0});
    }
    return out.toArray(new double[0][]);
  }

  private static String get(String url) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
    c.setConnectTimeout(8000); c.setReadTimeout(15000);
    try {
      if (c.getResponseCode() != 200) return null;
      try (InputStream in = c.getInputStream()) { return new String(MatchCenter.readAll(in), "UTF-8"); }
    } finally { c.disconnect(); }
  }

  /** Blocking: adds the goals markets and the last day of the three chances (each one may fail alone). */
  static void details(Odds o) {
    try {
      String body = get(API + "?slug=" + URLEncoder.encode(o.slug + "-more-markets", "UTF-8"));
      JSONArray events = body == null ? null : new JSONArray(body);
      if (events != null && events.length() > 0) goals(events.optJSONObject(0), o);
    } catch (Exception ignored) {}
    try {
      double[][][] h = new double[3][][];
      for (int i = 0; i < 3; i++) {
        if (!o.tokens[i].matches("\\d{10,90}")) return;
        String body = get(CLOB + "?market=" + o.tokens[i] + "&interval=1d&fidelity=10");
        h[i] = body == null ? new double[0][] : series(new JSONObject(body));
        if (h[i].length < 2) return;
      }
      o.history = h;
    } catch (Exception ignored) {}
  }
}
