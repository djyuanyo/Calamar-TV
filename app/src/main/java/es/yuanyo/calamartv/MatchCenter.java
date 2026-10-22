package es.yuanyo.calamartv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The match under the video of an event with a Google match link, on phones and tablets (Android TV keeps
 * the full-screen player): general information, statistics and line-ups from ESPN's match summary, in
 * tabs, as on the web.
 */
final class MatchCenter {
  static final class Team { String id = "", name = "", shortName = "", logo = "", score = ""; }
  static final class Event { String minute = "", kind = "", side = "", player = "", other = ""; }
  static final class Stat { String label = "", home = "", away = ""; double share = 0.5; }
  static final class Player { String number = "", name = "", position = ""; boolean in, out; }
  static final class Lineup { String side = "", formation = ""; Team team; final List<Player> starters = new ArrayList<>(), subs = new ArrayList<>(); }
  static final class Model {
    String status = "", state = "", league = "", date = "", venue = "", city = "", referee = "";
    boolean live; int attendance;
    final Team home = new Team(), away = new Team();
    final List<Event> events = new ArrayList<>();
    final List<Stat> stats = new ArrayList<>();
    final List<Lineup> lineups = new ArrayList<>();
  }

  // ESPN's statistic names, in the order and with the names they are shown in (the same as the web).
  static final String[][] STATS = {
    {"possessionPct", "Posesión", "%"}, {"totalShots", "Tiros", ""}, {"shotsOnTarget", "Tiros a puerta", ""}, {"wonCorners", "Córners", ""},
    {"foulsCommitted", "Faltas", ""}, {"offsides", "Fueras de juego", ""}, {"yellowCards", "Tarjetas amarillas", ""}, {"redCards", "Tarjetas rojas", ""},
    {"saves", "Paradas", ""}, {"totalPasses", "Pases", ""}, {"accuratePasses", "Pases completados", ""}, {"passPct", "Precisión de pase", "%"},
    {"totalCrosses", "Centros", ""}, {"totalLongBalls", "Balones largos", ""}, {"blockedShots", "Tiros bloqueados", ""}, {"totalTackles", "Entradas", ""},
    {"interceptions", "Intercepciones", ""}, {"totalClearance", "Despejes", ""}};
  static final Map<String, String> KIND = new HashMap<>();
  static {
    KIND.put("goal", "Gol"); KIND.put("penalty", "Gol de penalti"); KIND.put("own-goal", "Gol en propia puerta");
    KIND.put("penalty-missed", "Penalti fallado"); KIND.put("yellow", "Tarjeta amarilla"); KIND.put("red", "Tarjeta roja"); KIND.put("sub", "Cambio");
  }

  static String kind(JSONObject e) {
    JSONObject type = e.optJSONObject("type");
    String t = ((type == null ? "" : type.optString("type")) + " " + (type == null ? "" : type.optString("text"))).toLowerCase(Locale.ROOT);
    if (t.matches(".*(own.?goal|propia).*")) return "own-goal";
    if (t.matches(".*penalty.*(miss|saved|fallad).*")) return "penalty-missed";
    if (t.matches(".*(penalty|penalti).*") && (e.optBoolean("scoringPlay") || t.matches(".*(scored|goal).*"))) return "penalty";
    if (e.optBoolean("scoringPlay") || t.matches(".*(goal|gol).*")) return "goal";
    if (t.matches(".*(red|roja|second yellow).*")) return "red";
    if (t.matches(".*(yellow|amarilla).*")) return "yellow";
    if (t.matches(".*(substitution|cambio).*")) return "sub";
    return "";
  }

  static String https(String url) { return url != null && url.startsWith("https://") ? url : ""; }

  /** Turns ESPN's summary into what the three tabs show; anything ESPN leaves out is simply not shown. */
  static Model parse(JSONObject data) throws Exception {
    MatchScores.Result result = MatchScores.parse(data);
    Model m = new Model();
    m.status = result.text; m.state = result.state; m.live = result.live;
    JSONObject header = data.optJSONObject("header");
    if (header == null) header = new JSONObject();
    JSONArray comps = header.optJSONArray("competitions");
    JSONObject comp = comps != null && comps.length() > 0 ? comps.getJSONObject(0) : new JSONObject();
    JSONArray competitors = comp.optJSONArray("competitors");
    if (competitors == null) competitors = new JSONArray();
    for (int i = 0; i < competitors.length(); i++) {
      JSONObject c = competitors.getJSONObject(i), team = c.optJSONObject("team");
      if (team == null) team = new JSONObject();
      Team t = "away".equals(c.optString("homeAway")) ? m.away : m.home;
      t.id = team.optString("id"); t.name = team.optString("displayName", team.optString("name")); t.shortName = team.optString("abbreviation");
      JSONArray logos = team.optJSONArray("logos");
      t.logo = https(team.optString("logo", logos != null && logos.length() > 0 ? logos.getJSONObject(0).optString("href") : ""));
      String score = MatchScores.score(c);
      t.score = score.matches("\\d+") ? score : "";
    }
    JSONArray keyEvents = data.optJSONArray("keyEvents");
    if (keyEvents != null) for (int i = 0; i < keyEvents.length(); i++) {
      JSONObject e = keyEvents.getJSONObject(i);
      String k = kind(e);
      if (k.isEmpty()) continue;
      Event ev = new Event();
      ev.kind = k;
      JSONObject clock = e.optJSONObject("clock");
      ev.minute = clock == null ? "" : clock.optString("displayValue");
      ev.side = side(m, e.optJSONObject("team"));
      JSONArray people = e.optJSONArray("participants");
      List<String> names = new ArrayList<>();
      if (people != null) for (int j = 0; j < people.length(); j++) {
        JSONObject athlete = people.getJSONObject(j).optJSONObject("athlete");
        if (athlete != null && !athlete.optString("displayName").isEmpty()) names.add(athlete.optString("displayName"));
      }
      ev.player = names.isEmpty() ? "" : names.get(0);
      ev.other = names.size() > 1 ? names.get(1) : "";
      m.events.add(ev);
    }
    JSONObject box = data.optJSONObject("boxscore");
    JSONArray boxTeams = box == null ? null : box.optJSONArray("teams");
    Map<String, String> homeStats = new HashMap<>(), awayStats = new HashMap<>();
    if (boxTeams != null) for (int i = 0; i < boxTeams.length(); i++) {
      JSONObject t = boxTeams.getJSONObject(i);
      String s = side(m, t.optJSONObject("team"));
      Map<String, String> target = "away".equals(s) || (s.isEmpty() && i == 1) ? awayStats : homeStats;
      JSONArray list = t.optJSONArray("statistics");
      if (list != null) for (int j = 0; j < list.length(); j++) target.put(list.getJSONObject(j).optString("name"), list.getJSONObject(j).optString("displayValue"));
    }
    for (String[] def : STATS) {
      String h = homeStats.get(def[0]), a = awayStats.get(def[0]);
      if (h == null && a == null) continue;
      Stat st = new Stat();
      st.label = def[1];
      st.home = (h == null ? "0" : h) + (h != null && !h.contains("%") ? def[2] : "");
      st.away = (a == null ? "0" : a) + (a != null && !a.contains("%") ? def[2] : "");
      double hv = number(h), av = number(a);
      st.share = hv + av > 0 ? hv / (hv + av) : 0.5;
      m.stats.add(st);
    }
    JSONArray rosters = data.optJSONArray("rosters");
    for (String s : new String[] {"home", "away"}) {
      if (rosters == null) break;
      for (int i = 0; i < rosters.length(); i++) {
        JSONObject r = rosters.getJSONObject(i);
        JSONArray roster = r.optJSONArray("roster");
        if (!s.equals(r.optString("homeAway")) || roster == null || roster.length() == 0) continue;
        Lineup l = new Lineup();
        l.side = s; l.team = s.equals("home") ? m.home : m.away; l.formation = r.optString("formation");
        List<JSONObject> sorted = new ArrayList<>();
        for (int j = 0; j < roster.length(); j++) sorted.add(roster.getJSONObject(j));
        Collections.sort(sorted, (x, y) -> Double.compare(place(x), place(y)));
        for (JSONObject p : sorted) {
          Player pl = new Player();
          pl.number = p.optString("jersey");
          JSONObject athlete = p.optJSONObject("athlete");
          pl.name = athlete == null ? "" : athlete.optString("displayName", athlete.optString("shortName"));
          JSONObject position = p.optJSONObject("position");
          pl.position = position == null ? "" : position.optString("abbreviation");
          pl.in = p.optBoolean("subbedIn"); pl.out = p.optBoolean("subbedOut");
          (p.optBoolean("starter") ? l.starters : l.subs).add(pl);
        }
        m.lineups.add(l);
      }
    }
    JSONObject league = header.optJSONObject("league");
    m.league = league == null ? "" : league.optString("name", league.optString("abbreviation"));
    m.date = comp.optString("date", header.optString("date"));
    JSONObject info = data.optJSONObject("gameInfo");
    if (info == null) info = new JSONObject();
    JSONObject venue = info.optJSONObject("venue");
    if (venue == null) venue = comp.optJSONObject("venue");
    if (venue != null) {
      m.venue = venue.optString("fullName");
      JSONObject address = venue.optJSONObject("address");
      if (address != null) {
        List<String> parts = new ArrayList<>();
        for (String key : new String[] {"city", "country"}) if (!address.optString(key).isEmpty()) parts.add(address.optString(key));
        m.city = String.join(", ", parts);
      }
    }
    m.attendance = Math.max(0, info.optInt("attendance"));
    JSONArray officials = info.optJSONArray("officials");
    if (officials != null && officials.length() > 0) {
      JSONObject referee = officials.getJSONObject(0);
      for (int i = 0; i < officials.length(); i++) {
        JSONObject position = officials.getJSONObject(i).optJSONObject("position");
        String what = position == null ? "" : position.optString("displayName", position.optString("name"));
        if (what.matches("(?i).*(referee|árbitro).*")) { referee = officials.getJSONObject(i); break; }
      }
      m.referee = referee.optString("displayName", referee.optString("fullName"));
    }
    return m;
  }

  static double place(JSONObject p) {
    try { return Double.parseDouble(p.optString("formationPlace")); } catch (NumberFormatException none) { return 99; }
  }

  static double number(String v) {
    if (v == null) return 0;
    try { return Double.parseDouble(v.replace(',', '.').replace("%", "")); } catch (NumberFormatException none) { return 0; }
  }

  static String side(Model m, JSONObject team) {
    if (team == null) return "";
    if (!team.optString("id").isEmpty() && team.optString("id").equals(m.home.id)) return "home";
    if (!team.optString("id").isEmpty() && team.optString("id").equals(m.away.id)) return "away";
    if (team.optString("displayName").equals(m.home.name) && !m.home.name.isEmpty()) return "home";
    if (team.optString("displayName").equals(m.away.name) && !m.away.name.isEmpty()) return "away";
    return "";
  }

  // ---- The view ------------------------------------------------------------------------------

  final Context context;
  final ScrollView view;
  final LinearLayout page, content;
  final LinearLayout tabs;
  final Map<String, Bitmap> logos = new HashMap<>();
  final Handler handler = new Handler(Looper.getMainLooper());
  Model model;
  String tab = "info";

  MatchCenter(Context context) {
    this.context = context;
    view = new ScrollView(context);
    view.setBackgroundColor(Ui.BG);
    view.setFillViewport(true);
    page = new LinearLayout(context);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setPadding(dp(14), dp(12), dp(14), dp(28));
    view.addView(page);
    tabs = new LinearLayout(context);
    content = new LinearLayout(context);
    content.setOrientation(LinearLayout.VERTICAL);
    page.addView(text("Cargando datos del partido…", 14, Ui.MUTED, false));
  }

  int dp(int n) { return Ui.dp(context, n); }

  TextView text(String value, int size, int color, boolean bold) {
    TextView t = new TextView(context);
    t.setText(value);
    t.setTextSize(size);
    t.setTextColor(color);
    if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    return t;
  }

  void failed() {
    if (model != null) return;
    page.removeAllViews();
    page.addView(text("No se pudieron cargar los datos del partido. Se volverá a intentar en unos segundos.", 14, Ui.MUTED, false));
  }

  void show(Model m) {
    model = m;
    boolean tabFocused = tabs.hasFocus();
    page.removeAllViews();
    page.addView(board(m));
    tabs.removeAllViews();
    tabs.setOrientation(LinearLayout.HORIZONTAL);
    String[][] names = {{"info", "INFORMACIÓN"}, {"stats", "ESTADÍSTICAS"}, {"lineups", "ALINEACIONES"}};
    for (final String[] n : names) {
      LinearLayout t = new LinearLayout(context);
      t.setOrientation(LinearLayout.VERTICAL);
      t.setGravity(Gravity.CENTER_HORIZONTAL);
      t.setFocusable(true);
      t.setClickable(true);
      t.setBackground(Ui.focusFill(context, 0, 0x1fffffff, Ui.ACC, 8, 0));
      TextView label = text(n[1], 12, n[0].equals(tab) ? Ui.FG : Ui.MUTED, true);
      label.setLetterSpacing(0.04f);
      label.setGravity(Gravity.CENTER);
      label.setPadding(0, dp(12), 0, dp(9));
      t.addView(label);
      View bar = new View(context);
      bar.setBackground(Ui.shape(context, n[0].equals(tab) ? Ui.ACC : 0, 2, 0, 0));
      LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(dp(56), dp(3));
      t.addView(bar, bp);
      t.setContentDescription(n[1] + (n[0].equals(tab) ? ", seleccionada" : ""));
      t.setTag(n[0]);
      t.setOnClickListener(v -> { tab = n[0]; show(model); View again = tabs.findViewWithTag(n[0]); if (again != null) again.requestFocus(); });
      tabs.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
    }
    LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-1, -2);
    tp.setMargins(0, dp(14), 0, dp(4));
    page.addView(tabs, tp);
    View line = new View(context);
    line.setBackgroundColor(0xff2a313b);
    page.addView(line, new LinearLayout.LayoutParams(-1, dp(1)));
    content.removeAllViews();
    if (tab.equals("stats")) stats(m); else if (tab.equals("lineups")) lineups(m); else info(m);
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1, -2);
    cp.setMargins(0, dp(12), 0, 0);
    page.addView(content, cp);
    TextView credit = text("Datos: ESPN. Se actualizan cada 30 segundos.", 11, Ui.FAINT, false);
    credit.setGravity(Gravity.CENTER);
    credit.setPadding(0, dp(14), 0, 0);
    page.addView(credit, new LinearLayout.LayoutParams(-1, -2));
    if (tabFocused) { View again = tabs.findViewWithTag(tab); if (again != null) again.requestFocus(); }
  }

  View board(Model m) {
    LinearLayout b = new LinearLayout(context);
    b.setGravity(Gravity.CENTER_VERTICAL);
    b.setPadding(dp(12), dp(16), dp(12), dp(16));
    b.setBackground(Ui.shape(context, Ui.SURFACE, 16, 1, 0xff2a313b));
    b.addView(team(m.home), new LinearLayout.LayoutParams(0, -2, 1));
    LinearLayout middle = new LinearLayout(context);
    middle.setOrientation(LinearLayout.VERTICAL);
    middle.setGravity(Gravity.CENTER_HORIZONTAL);
    boolean scored = !m.home.score.isEmpty() && !m.away.score.isEmpty();
    TextView score = text(scored ? m.home.score + " – " + m.away.score : "vs", scored ? 34 : 22, scored ? Ui.FG : Ui.MUTED, true);
    middle.addView(score);
    TextView status = text(m.status.replaceFirst("^\\d+ – \\d+ · ", ""), 11, m.live ? 0xffffffff : Ui.MUTED, true);
    status.setPadding(dp(10), dp(3), dp(10), dp(3));
    status.setBackground(Ui.shape(context, m.live ? 0xffff3b3b : 0xff1d232b, 999, 0, 0));
    LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, -2);
    sp.topMargin = dp(6);
    middle.addView(status, sp);
    b.addView(middle, new LinearLayout.LayoutParams(-2, -2));
    b.addView(team(m.away), new LinearLayout.LayoutParams(0, -2, 1));
    return b;
  }

  View team(Team t) {
    LinearLayout box = new LinearLayout(context);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setGravity(Gravity.CENTER_HORIZONTAL);
    box.addView(crest(t, 52), new LinearLayout.LayoutParams(dp(52), dp(52)));
    TextView name = text(t.name, 14, Ui.FG, true);
    name.setGravity(Gravity.CENTER);
    name.setPadding(dp(4), dp(8), dp(4), 0);
    box.addView(name);
    return box;
  }

  View crest(Team t, int size) {
    FrameLayout frame = new FrameLayout(context);
    TextView initials = text((t.shortName.isEmpty() ? t.name : t.shortName).length() > 3 ? (t.shortName.isEmpty() ? t.name : t.shortName).substring(0, 3) : (t.shortName.isEmpty() ? t.name : t.shortName), size > 40 ? 13 : 9, Ui.MUTED, true);
    initials.setGravity(Gravity.CENTER);
    initials.setBackground(Ui.shape(context, 0xff1d232b, 999, 0, 0));
    frame.addView(initials, new FrameLayout.LayoutParams(-1, -1));
    if (!t.logo.isEmpty()) {
      ImageView logo = new ImageView(context);
      logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
      frame.addView(logo, new FrameLayout.LayoutParams(-1, -1));
      load(logo, initials, t.logo);
    }
    return frame;
  }

  void load(final ImageView view, final View placeholder, final String url) {
    Bitmap cached = logos.get(url);
    if (cached != null) { view.setImageBitmap(cached); placeholder.setVisibility(View.INVISIBLE); return; }
    new Thread(() -> {
      try {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(6000); c.setReadTimeout(7000);
        try (InputStream in = c.getInputStream()) {
          final Bitmap b = BitmapFactory.decodeStream(in);
          if (b != null) handler.post(() -> { logos.put(url, b); view.setImageBitmap(b); placeholder.setVisibility(View.INVISIBLE); });
        } finally { c.disconnect(); }
      } catch (Exception ignored) {}
    }).start();
  }

  void empty(String message) {
    TextView t = text(message, 14, Ui.MUTED, false);
    t.setGravity(Gravity.CENTER);
    t.setPadding(0, dp(18), 0, dp(18));
    content.addView(t, new LinearLayout.LayoutParams(-1, -2));
  }

  void info(Model m) {
    if (m.events.isEmpty()) empty(m.state.equals("scheduled") ? "El partido aún no ha empezado." : "Sin incidencias por ahora.");
    for (Event e : m.events) {
      LinearLayout r = new LinearLayout(context);
      r.setGravity(Gravity.CENTER_VERTICAL);
      r.setPadding(dp(12), dp(8), dp(12), dp(8));
      r.setBackground(Ui.shape(context, Ui.SURFACE, 10, 0, 0));
      boolean away = e.side.equals("away");
      TextView minute = text(e.minute, 14, Ui.ACC, true);
      minute.setMinWidth(dp(40));
      minute.setGravity(away ? Gravity.END : Gravity.START);
      View icon = icon(e.kind);
      LinearLayout what = new LinearLayout(context);
      what.setOrientation(LinearLayout.VERTICAL);
      what.setGravity(away ? Gravity.END : Gravity.START);
      what.addView(text(e.player.isEmpty() ? KIND.get(e.kind) : e.player, 14, Ui.FG, true));
      what.addView(text(e.kind.equals("sub") && !e.other.isEmpty() ? "Sale " + e.other : KIND.get(e.kind), 12, Ui.MUTED, false));
      LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(28), dp(28));
      ip.setMargins(dp(6), 0, dp(6), 0);
      if (away) { r.addView(what, new LinearLayout.LayoutParams(0, -2, 1)); r.addView(icon, ip); r.addView(minute); }
      else { r.addView(minute); r.addView(icon, ip); r.addView(what, new LinearLayout.LayoutParams(0, -2, 1)); }
      r.setContentDescription(e.minute + " " + KIND.get(e.kind) + " " + e.player);
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
      p.bottomMargin = dp(6);
      content.addView(r, p);
    }
    List<String[]> facts = new ArrayList<>();
    String when = "";
    long at = SportsCatalog.instant(MatchScores.iso(m.date));
    if (at != Long.MAX_VALUE) {
      SimpleDateFormat f = new SimpleDateFormat("EEEE d 'de' MMMM, HH:mm", new Locale("es", "ES"));
      f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
      when = f.format(new Date(at));
    }
    for (String[] fact : Arrays.asList(new String[] {"Competición", m.league}, new String[] {"Fecha", when}, new String[] {"Estadio", m.venue},
        new String[] {"Ciudad", m.city}, new String[] {"Asistencia", m.attendance > 0 ? String.format(new Locale("es", "ES"), "%,d", m.attendance) : ""},
        new String[] {"Árbitro", m.referee})) if (!fact[1].isEmpty()) facts.add(fact);
    if (facts.isEmpty()) return;
    LinearLayout box = new LinearLayout(context);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(14), dp(10), dp(14), dp(10));
    box.setBackground(Ui.shape(context, Ui.SURFACE, 12, 0, 0));
    for (String[] fact : facts) {
      LinearLayout r = new LinearLayout(context);
      r.setPadding(0, dp(5), 0, dp(5));
      TextView k = text(fact[0], 13, Ui.MUTED, false);
      r.addView(k, new LinearLayout.LayoutParams(dp(100), -2));
      r.addView(text(fact[1], 14, Ui.FG, true), new LinearLayout.LayoutParams(0, -2, 1));
      box.addView(r);
    }
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.topMargin = dp(10);
    content.addView(box, p);
  }

  View icon(String kind) {
    if (kind.equals("yellow") || kind.equals("red")) {
      FrameLayout f = new FrameLayout(context);
      View card = new View(context);
      card.setBackground(Ui.shape(context, kind.equals("red") ? 0xffff3b3b : 0xffffd400, 2, 0, 0));
      f.addView(card, new FrameLayout.LayoutParams(dp(12), dp(16), Gravity.CENTER));
      return f;
    }
    TextView t = text(kind.equals("sub") ? "⇄" : kind.equals("penalty-missed") ? "✕" : "⚽", 16, kind.equals("sub") ? Ui.ACC : Ui.FG, true);
    t.setGravity(Gravity.CENTER);
    return t;
  }

  void stats(Model m) {
    if (m.stats.isEmpty()) { empty(m.state.equals("scheduled") ? "Las estadísticas aparecerán cuando empiece el partido." : "ESPN no tiene estadísticas de este partido."); return; }
    LinearLayout head = new LinearLayout(context);
    head.addView(text(m.home.shortName.isEmpty() ? m.home.name : m.home.shortName, 14, Ui.FG, true), new LinearLayout.LayoutParams(0, -2, 1));
    TextView right = text(m.away.shortName.isEmpty() ? m.away.name : m.away.shortName, 14, Ui.FG, true);
    right.setGravity(Gravity.END);
    head.addView(right, new LinearLayout.LayoutParams(0, -2, 1));
    content.addView(head);
    for (Stat s : m.stats) {
      LinearLayout row = new LinearLayout(context);
      row.setPadding(0, dp(12), 0, dp(4));
      TextView h = text(s.home, 14, s.share > 0.5 ? Ui.FG : Ui.MUTED, true);
      row.addView(h, new LinearLayout.LayoutParams(dp(64), -2));
      TextView label = text(s.label, 13, Ui.MUTED, false);
      label.setGravity(Gravity.CENTER);
      row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
      TextView a = text(s.away, 14, s.share < 0.5 ? Ui.FG : Ui.MUTED, true);
      a.setGravity(Gravity.END);
      row.addView(a, new LinearLayout.LayoutParams(dp(64), -2));
      content.addView(row);
      LinearLayout bars = new LinearLayout(context);
      bars.addView(bar((float) s.share, Ui.ACC, true), new LinearLayout.LayoutParams(0, dp(6), 1));
      View gap = new View(context);
      bars.addView(gap, new LinearLayout.LayoutParams(dp(6), dp(6)));
      bars.addView(bar((float) (1 - s.share), 0xff7fb2ff, false), new LinearLayout.LayoutParams(0, dp(6), 1));
      content.addView(bars);
    }
  }

  View bar(float share, int color, boolean fromEnd) {
    LinearLayout track = new LinearLayout(context);
    track.setBackground(Ui.shape(context, 0xff1d232b, 3, 0, 0));
    View fill = new View(context);
    fill.setBackground(Ui.shape(context, color, 3, 0, 0));
    View rest = new View(context);
    if (fromEnd) { track.addView(rest, new LinearLayout.LayoutParams(0, -1, 1 - share)); track.addView(fill, new LinearLayout.LayoutParams(0, -1, share)); }
    else { track.addView(fill, new LinearLayout.LayoutParams(0, -1, share)); track.addView(rest, new LinearLayout.LayoutParams(0, -1, 1 - share)); }
    return track;
  }

  void lineups(Model m) {
    if (m.lineups.isEmpty()) { empty(m.state.equals("scheduled") ? "Las alineaciones se publican poco antes del partido." : "ESPN no tiene las alineaciones de este partido."); return; }
    for (Lineup l : m.lineups) {
      LinearLayout box = new LinearLayout(context);
      box.setOrientation(LinearLayout.VERTICAL);
      box.setPadding(dp(14), dp(12), dp(14), dp(12));
      box.setBackground(Ui.shape(context, Ui.SURFACE, 12, 0, 0));
      LinearLayout head = new LinearLayout(context);
      head.setGravity(Gravity.CENTER_VERTICAL);
      head.addView(crest(l.team, 28), new LinearLayout.LayoutParams(dp(28), dp(28)));
      TextView name = text(l.team.name, 16, Ui.FG, true);
      name.setPadding(dp(10), 0, dp(10), 0);
      head.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
      if (!l.formation.isEmpty()) {
        TextView formation = text(l.formation, 12, Ui.ACC, true);
        formation.setPadding(dp(8), dp(3), dp(8), dp(3));
        formation.setBackground(Ui.shape(context, 0xff1d232b, 999, 0, 0));
        head.addView(formation);
      }
      box.addView(head);
      players(box, l.starters);
      if (!l.subs.isEmpty()) {
        TextView subs = text("SUPLENTES", 12, Ui.MUTED, true);
        subs.setPadding(0, dp(14), 0, dp(4));
        box.addView(subs);
        players(box, l.subs);
      }
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
      p.bottomMargin = dp(12);
      content.addView(box, p);
    }
  }

  void players(LinearLayout box, List<Player> list) {
    for (Player p : list) {
      LinearLayout r = new LinearLayout(context);
      r.setGravity(Gravity.CENTER_VERTICAL);
      r.setPadding(0, dp(6), 0, dp(6));
      TextView number = text(p.number, 14, Ui.ACC, true);
      number.setGravity(Gravity.END);
      r.addView(number, new LinearLayout.LayoutParams(dp(28), -2));
      TextView name = text(p.name + (p.out ? " ↓" : "") + (p.in ? " ↑" : ""), 14, Ui.FG, false);
      name.setPadding(dp(10), 0, dp(8), 0);
      r.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
      r.addView(text(p.position, 12, Ui.MUTED, false));
      box.addView(r);
    }
  }
}
