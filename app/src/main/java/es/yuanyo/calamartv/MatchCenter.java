package es.yuanyo.calamartv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Typeface;
import android.net.Uri;
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
  static final class Stat { String key = "", label = "", home = "", away = ""; double share = 0.5; }
  static final class Form { String result = "", score = "", opponent = ""; }
  static final class Meeting { String date = "", competition = "", home = "", away = "", score = ""; boolean upcoming, dateKnown = true; }
  static final class Player implements Pitch.Spot {
    String number = "", name = "", shortName = "", position = "", place = "", shirt = "", subAt = "", photo = ""; boolean in, out; int goals, ownGoals, yellow, red;
    double rating = Double.NaN;
    public String position() { return position; }
    public String place() { return place; }
  }
  static final class Lineup { String side = "", formation = ""; Team team; final List<Player> starters = new ArrayList<>(), subs = new ArrayList<>(); }
  static final class Model {
    String status = "", state = "", league = "", date = "", venue = "", city = "", referee = "", clock = "", round = "", description = "", note = "", source = "espn";
    boolean live; int attendance;
    final Team home = new Team(), away = new Team();
    final List<Event> events = new ArrayList<>();
    final List<Stat> stats = new ArrayList<>();
    final List<Lineup> lineups = new ArrayList<>();
    final List<Form> homeForm = new ArrayList<>(), awayForm = new ArrayList<>();
    final List<Meeting> h2h = new ArrayList<>();
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
      st.key = def[0];
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
          pl.shortName = athlete == null ? "" : athlete.optString("shortName", pl.name);
          JSONObject position = p.optJSONObject("position");
          pl.position = position == null ? "" : position.optString("abbreviation");
          pl.place = p.optString("formationPlace");
          pl.in = p.optBoolean("subbedIn"); pl.out = p.optBoolean("subbedOut");
          // The shirt with his number (ESPN draws it per match), on the dark background when there is one.
          JSONArray shirts = athlete == null ? null : athlete.optJSONArray("jerseyImages");
          for (int k = 0; shirts != null && k < shirts.length(); k++) {
            JSONObject j = shirts.optJSONObject(k);
            String href = j == null ? "" : j.optString("href");
            if (!href.startsWith("https://")) continue;
            if (pl.shirt.isEmpty() || String.valueOf(j.optJSONArray("rel")).contains("dark")) pl.shirt = href;
          }
          JSONArray stats = p.optJSONArray("stats");
          for (int k = 0; stats != null && k < stats.length(); k++) {
            JSONObject st = stats.optJSONObject(k);
            if (st == null) continue;
            int value = (int) number(st.optString("value", st.optString("displayValue")));
            switch (st.optString("name")) {
              case "totalGoals": pl.goals = value; break;
              case "ownGoals": pl.ownGoals = value; break;
              case "yellowCards": pl.yellow = value; break;
              case "redCards": pl.red = value; break;
              default: break;
            }
          }
          JSONArray plays = p.optJSONArray("plays");
          for (int k = 0; plays != null && k < plays.length(); k++) {
            JSONObject play = plays.optJSONObject(k);
            if (play != null && play.optBoolean("substitution")) { JSONObject clock = play.optJSONObject("clock"); pl.subAt = clock == null ? "" : clock.optString("displayValue"); break; }
          }
          (p.optBoolean("starter") ? l.starters : l.subs).add(pl);
        }
        m.lineups.add(l);
      }
    }
    JSONObject status = comp.optJSONObject("status");
    if (m.live && status != null) m.clock = status.optString("displayClock");
    // Last results of each team and earlier meetings between them.
    JSONArray forms = box == null ? null : box.optJSONArray("form");
    // ESPN moved the teams' last results from boxscore.form to lastFiveGames (same shape).
    if (forms == null || forms.length() == 0) forms = data.optJSONArray("lastFiveGames");
    if (forms != null) for (int i = 0; i < forms.length(); i++) {
      JSONObject f = forms.getJSONObject(i);
      String s = side(m, f.optJSONObject("team"));
      List<Form> target = s.equals("home") ? m.homeForm : s.equals("away") ? m.awayForm : null;
      JSONArray games = f.optJSONArray("events");
      if (target == null || games == null) continue;
      for (int j = 0; j < games.length() && target.size() < 5; j++) {
        JSONObject g = games.getJSONObject(j);
        Form r = new Form();
        r.result = g.optString("gameResult").toUpperCase(Locale.ROOT);
        if (r.result.isEmpty()) continue;
        r.result = r.result.substring(0, 1);
        r.score = g.optString("score");
        JSONObject opponent = g.optJSONObject("opponent");
        r.opponent = opponent == null ? "" : opponent.optString("displayName");
        target.add(r);
      }
    }
    JSONArray meetings = data.optJSONArray("headToHeadGames");
    java.util.Set<String> seen = new java.util.HashSet<>();
    if (meetings != null) for (int i = 0; i < meetings.length(); i++) {
      JSONObject block = meetings.getJSONObject(i), own = block.optJSONObject("team");
      if (own == null) own = new JSONObject();
      JSONArray games = block.optJSONArray("events");
      if (games != null) for (int j = 0; j < games.length(); j++) {
        JSONObject g = games.getJSONObject(j);
        String key = g.optString("id", g.optString("gameDate") + g.optString("score"));
        if (!seen.add(key)) continue;
        boolean ownHome = g.optString("homeTeamId").equals(own.optString("id")) || "vs".equals(g.optString("atVs", "vs"));
        JSONObject opponent = g.optJSONObject("opponent");
        String other = opponent == null ? "" : opponent.optString("displayName");
        Meeting mt = new Meeting();
        mt.date = g.optString("gameDate");
        mt.competition = g.optString("leagueName", g.optString("leagueAbbreviation"));
        mt.home = ownHome ? own.optString("displayName") : other;
        mt.away = ownHome ? other : own.optString("displayName");
        String[] goals = g.optString("score").replaceAll("[^0-9]+", " ").trim().split(" ");
        mt.score = goals.length == 2 ? (ownHome ? goals[0] + " – " + goals[1] : goals[1] + " – " + goals[0]) : g.optString("score");
        m.h2h.add(mt);
      }
    }
    // Now ESPN sends the last meetings, in any competition, as seasonseries (also before the match starts).
    JSONArray series = data.optJSONArray("seasonseries");
    if (series != null) for (int i = 0; i < series.length(); i++) {
      JSONObject block = series.optJSONObject(i);
      JSONArray games = block == null ? null : block.optJSONArray("events");
      if (games != null) for (int j = 0; j < games.length(); j++) {
        JSONObject g = games.optJSONObject(j);
        // This very match is not one of its own meetings; the ones still to play come first, as «Próximo».
        if (g == null || !seen.add(g.optString("id")) || g.optString("id").equals(header.optString("id"))) continue;
        JSONObject type = g.optJSONObject("statusType");
        boolean upcoming = "pre".equals(g.optString("status")) || (type != null && "pre".equals(type.optString("state")));
        JSONObject home = null, away = null;
        JSONArray sides = g.optJSONArray("competitors");
        if (sides != null) for (int k = 0; k < sides.length(); k++) {
          JSONObject c = sides.optJSONObject(k);
          if (c == null) continue;
          if ("home".equals(c.optString("homeAway"))) home = c; else if ("away".equals(c.optString("homeAway"))) away = c;
        }
        if (home == null || away == null || home.optJSONObject("team") == null || away.optJSONObject("team") == null) continue;
        Meeting mt = new Meeting();
        mt.date = g.optString("date");
        String round = g.optString("roundName");
        mt.competition = g.optString("competitionName") + (round.isEmpty() ? "" : " · " + round);
        mt.home = home.optJSONObject("team").optString("displayName");
        mt.away = away.optJSONObject("team").optString("displayName");
        mt.upcoming = upcoming;
        mt.dateKnown = g.optBoolean("timeValid", true);
        mt.score = upcoming || home.optString("score").isEmpty() || away.optString("score").isEmpty() ? "" : home.optString("score") + " – " + away.optString("score");
        m.h2h.add(mt);
      }
    }
    // Still to play first (soonest first), then the results (latest first).
    Collections.sort(m.h2h, (a, b) -> a.upcoming != b.upcoming ? (a.upcoming ? -1 : 1)
        : a.upcoming ? Long.compare(SportsCatalog.instant(MatchScores.iso(a.date)), SportsCatalog.instant(MatchScores.iso(b.date)))
        : Long.compare(SportsCatalog.instant(MatchScores.iso(b.date)), SportsCatalog.instant(MatchScores.iso(a.date))));
    while (m.h2h.size() > 10) m.h2h.remove(m.h2h.size() - 1);
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

  /** The event's own data (from MainActivity.eventInfo), for events without ESPN data. */
  static Model fromEvent(JSONObject info) {
    Model m = new Model();
    m.source = "event"; m.state = "scheduled";
    m.status = info.optString("status");
    m.home.name = info.optString("home"); m.home.logo = https(info.optString("homeLogo"));
    m.away.name = info.optString("away"); m.away.logo = https(info.optString("awayLogo"));
    m.league = info.optString("league"); m.round = info.optString("round"); m.date = info.optString("startAt");
    m.venue = info.optString("venue"); m.description = info.optString("description");
    return m;
  }

  /** ESPN's data, keeping from the event what ESPN does not have (description, league, place, crests). */
  static Model merge(Model espn, Model event) {
    if (event == null) return espn;
    espn.description = event.description;
    if (espn.league.isEmpty()) espn.league = event.league;
    if (espn.round.isEmpty()) espn.round = event.round;
    if (espn.venue.isEmpty()) espn.venue = event.venue;
    if (espn.home.logo.isEmpty()) espn.home.logo = event.home.logo;
    if (espn.away.logo.isEmpty()) espn.away.logo = event.away.logo;
    return espn;
  }

  /** «45'+2'» is minute 47; «67'» is 67. */
  static int minute(String text) {
    String[] parts = (text == null ? "" : text).replaceAll("[^0-9]+", " ").trim().split(" ");
    int total = 0;
    for (int i = 0; i < Math.min(2, parts.length); i++) if (!parts[i].isEmpty()) total += Integer.parseInt(parts[i]);
    return total;
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

  static final int HOME = 0xff3d9bff, AWAY = 0xffffb52e, LINE = 0xff2a313b, SURFACE_2 = 0xff1d232b;

  final Context context;
  final ScrollView view;
  final LinearLayout page, content;
  final LinearLayout tabs;
  final Map<String, Bitmap> logos = new HashMap<>();
  final Handler handler = new Handler(Looper.getMainLooper());
  Model model;
  String tab = "general";

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

  LinearLayout card() {
    LinearLayout box = new LinearLayout(context);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(14), dp(12), dp(14), dp(12));
    box.setBackground(Ui.shape(context, Ui.SURFACE, 12, 0, 0));
    return box;
  }

  void add(View v) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.bottomMargin = dp(10);
    content.addView(v, p);
  }

  void show(Model m) {
    model = m;
    boolean tabFocused = tabs.hasFocus();
    page.removeAllViews();
    page.addView(board(m));
    tabs.removeAllViews();
    tabs.setOrientation(LinearLayout.HORIZONTAL);
    String[][] names = {{"general", "General"}, {"stats", "Estadísticas"}, {"lineups", "Alineaciones"}, {"h2h", "H2H"}};
    for (final String[] n : names) {
      LinearLayout t = new LinearLayout(context);
      t.setOrientation(LinearLayout.VERTICAL);
      t.setGravity(Gravity.CENTER_HORIZONTAL);
      t.setFocusable(true);
      t.setClickable(true);
      t.setBackground(Ui.focusFill(context, 0, 0x1fffffff, Ui.ACC, 8, 0));
      TextView label = text(n[1], 14, n[0].equals(tab) ? Ui.ACC : Ui.MUTED, true);
      label.setGravity(Gravity.CENTER);
      label.setSingleLine(true);
      label.setPadding(0, dp(12), 0, dp(9));
      t.addView(label);
      View bar = new View(context);
      bar.setBackground(Ui.shape(context, n[0].equals(tab) ? Ui.ACC : 0, 2, 0, 0));
      t.addView(bar, new LinearLayout.LayoutParams(dp(48), dp(3)));
      t.setContentDescription(n[1] + (n[0].equals(tab) ? ", seleccionada" : ""));
      t.setTag(n[0]);
      t.setOnClickListener(v -> { tab = n[0]; show(model); View again = tabs.findViewWithTag(n[0]); if (again != null) again.requestFocus(); });
      tabs.addView(t, new LinearLayout.LayoutParams(0, -2, n[0].equals("h2h") ? 0.7f : 1.1f));
    }
    LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-1, -2);
    tp.setMargins(0, dp(14), 0, 0);
    page.addView(tabs, tp);
    View line = new View(context);
    line.setBackgroundColor(LINE);
    page.addView(line, new LinearLayout.LayoutParams(-1, dp(1)));
    content.removeAllViews();
    String note = !m.note.isEmpty() ? m.note : m.source.equals("event")
        ? "Este evento no tiene enlace del partido. Al añadirlo en el administrador aparecerán aquí el marcador, las estadísticas y las alineaciones." : "";
    if (!note.isEmpty()) {
      LinearLayout box = card();
      box.addView(text(note, 14, Ui.MUTED, false));
      add(box);
    }
    if (tab.equals("lineups")) { playerExtras(m); applyExtras(m, extrasKey.equals(extrasKey(m)) ? extras : null); }
    if (tab.equals("stats")) stats(m); else if (tab.equals("lineups")) lineups(m); else if (tab.equals("h2h")) h2h(m); else general(m);
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1, -2);
    cp.setMargins(0, dp(12), 0, 0);
    page.addView(content, cp);
    if (tabFocused) { View again = tabs.findViewWithTag(tab); if (again != null) again.requestFocus(); }
  }

  String when(String iso, String pattern) {
    long at = SportsCatalog.instant(MatchScores.iso(iso));
    if (at == Long.MAX_VALUE) return "";
    SimpleDateFormat f = new SimpleDateFormat(pattern, new Locale("es", "ES"));
    f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
    return f.format(new Date(at));
  }

  View board(Model m) {
    LinearLayout b = new LinearLayout(context);
    b.setGravity(Gravity.CENTER_VERTICAL);
    b.setPadding(dp(12), dp(16), dp(12), dp(16));
    b.setBackground(Ui.shape(context, Ui.SURFACE, 16, 1, LINE));
    b.addView(team(m.home), new LinearLayout.LayoutParams(0, -2, 1));
    LinearLayout middle = new LinearLayout(context);
    middle.setOrientation(LinearLayout.VERTICAL);
    middle.setGravity(Gravity.CENTER_HORIZONTAL);
    boolean scored = !m.home.score.isEmpty() && !m.away.score.isEmpty();
    String kickoff = when(m.date, "HH:mm");
    middle.addView(text(scored ? m.home.score + " – " + m.away.score : kickoff.isEmpty() ? "vs" : kickoff, scored ? 34 : 24, scored ? Ui.FG : Ui.MUTED, true));
    String label = m.status.replaceFirst("^\\d+ – \\d+ · ", "");
    if (label.isEmpty()) label = when(m.date, "EEE d MMM");
    TextView status = text(label, 11, m.live ? 0xffffffff : Ui.MUTED, true);
    status.setPadding(dp(10), dp(3), dp(10), dp(3));
    status.setBackground(Ui.shape(context, m.live ? 0xffff3b3b : SURFACE_2, 999, 0, 0));
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
    String label = t.shortName.isEmpty() ? t.name : t.shortName;
    TextView initials = text(label.length() > 3 ? label.substring(0, 3) : label, size > 40 ? 13 : 9, Ui.MUTED, true);
    initials.setGravity(Gravity.CENTER);
    initials.setBackground(Ui.shape(context, SURFACE_2, 999, 0, 0));
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
    add(t);
  }

  View names(Model m) {
    LinearLayout r = new LinearLayout(context);
    TextView h = text("▎" + m.home.name, 14, Ui.FG, true);
    h.setTextColor(Ui.FG);
    r.addView(h, new LinearLayout.LayoutParams(0, -2, 1));
    TextView a = text(m.away.name + "▕", 14, Ui.FG, true);
    a.setGravity(Gravity.END);
    r.addView(a, new LinearLayout.LayoutParams(0, -2, 1));
    android.text.SpannableString hs = new android.text.SpannableString(h.getText());
    hs.setSpan(new android.text.style.ForegroundColorSpan(HOME), 0, 1, 0);
    h.setText(hs);
    android.text.SpannableString as = new android.text.SpannableString(a.getText());
    as.setSpan(new android.text.style.ForegroundColorSpan(AWAY), as.length() - 1, as.length(), 0);
    a.setText(as);
    return r;
  }

  Stat stat(Model m, String key) {
    for (Stat s : m.stats) if (s.key.equals(key)) return s;
    return null;
  }

  /** The development of the match from 0' to 90': goals and cards of each side on a coloured track. */
  final class Timeline extends View {
    final Model m;
    final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
    Timeline(Model m) { super(context); this.m = m; setContentDescription("Desarrollo del partido"); }

    @Override protected void onMeasure(int w, int h) { setMeasuredDimension(MeasureSpec.getSize(w), dp(86)); }

    @Override protected void onDraw(android.graphics.Canvas c) {
      float left = dp(12), right = getWidth() - dp(12), width = right - left;
      int max = 90;
      for (Event e : m.events) max = Math.max(max, minute(e.minute));
      if (m.live) max = Math.max(max, minute(m.clock));
      paint.setTextSize(dp(11));
      paint.setColor(Ui.FAINT);
      paint.setTextAlign(android.graphics.Paint.Align.CENTER);
      for (int n = 0; n <= 90; n += 15) c.drawText(n + "'", left + width * n / max, dp(12), paint);
      float top = dp(40), mid = dp(45), bottom = dp(50);
      paint.setColor((HOME & 0x00ffffff) | 0x59000000);
      c.drawRect(left, top, right, mid, paint);
      paint.setColor((AWAY & 0x00ffffff) | 0x59000000);
      c.drawRect(left, mid, right, bottom, paint);
      int now = m.state.equals("finished") ? max : m.live ? minute(m.clock) : m.state.equals("halftime") ? 45 : 0;
      float x = left + width * Math.min(now, max) / max;
      paint.setColor(HOME);
      c.drawRect(left, top, x, mid, paint);
      paint.setColor(AWAY);
      c.drawRect(left, mid, x, bottom, paint);
      if (now > 0 && now < max) { paint.setColor(0xffffffff); c.drawRect(x - dp(1), top - dp(2), x + dp(1), bottom + dp(2), paint); }
      paint.setColor(0x2effffff);
      for (int n = 15; n < 90; n += 15) { float gx = left + width * n / max; c.drawRect(gx, top, gx + 1, bottom, paint); }
      for (Event e : m.events) {
        if (e.kind.equals("sub") || e.side.isEmpty()) continue;
        float ex = left + width * Math.min(minute(e.minute), max) / max, cy = e.side.equals("home") ? dp(28) : dp(64);
        if (e.kind.equals("yellow") || e.kind.equals("red")) {
          paint.setColor(e.kind.equals("red") ? 0xffff3b3b : 0xffffd400);
          c.drawRoundRect(new android.graphics.RectF(ex - dp(5), cy - dp(7), ex + dp(5), cy + dp(7)), dp(2), dp(2), paint);
        } else {
          paint.setColor(0xffffffff);
          paint.setTextSize(dp(14));
          c.drawText(e.kind.equals("penalty-missed") ? "✕" : "⚽", ex, cy + dp(5), paint);
        }
      }
    }
  }

  /** A ring split between the two sides (blue home, yellow away), with each side's figure next to it. */
  final class Donut extends View {
    final float share;
    final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
    Donut(float share) { super(context); this.share = share; paint.setStyle(android.graphics.Paint.Style.STROKE); paint.setStrokeWidth(dp(5)); }
    @Override protected void onDraw(android.graphics.Canvas c) {
      float pad = dp(4);
      android.graphics.RectF r = new android.graphics.RectF(pad, pad, getWidth() - pad, getHeight() - pad);
      paint.setColor(HOME);
      c.drawArc(r, -90, 360 * share, false, paint);
      paint.setColor(AWAY);
      c.drawArc(r, -90 + 360 * share, 360 * (1 - share), false, paint);
    }
  }

  View gauge(String label, Stat s) {
    LinearLayout box = card();
    box.setGravity(Gravity.CENTER_HORIZONTAL);
    box.setPadding(dp(4), dp(10), dp(4), dp(10));
    TextView l = text(label, 12, Ui.MUTED, false);
    l.setGravity(Gravity.CENTER);
    l.setSingleLine(true);
    box.addView(l);
    LinearLayout row = new LinearLayout(context);
    row.setGravity(Gravity.CENTER);
    row.setPadding(0, dp(6), 0, 0);
    row.addView(text(s.home, 14, Ui.FG, true));
    LinearLayout.LayoutParams ring = new LinearLayout.LayoutParams(dp(40), dp(40));
    ring.setMargins(dp(6), 0, dp(6), 0);
    row.addView(new Donut((float) s.share), ring);
    row.addView(text(s.away, 14, Ui.FG, true));
    box.addView(row);
    box.setContentDescription(label + ": " + s.home + " a " + s.away);
    return box;
  }

  View cell(String icon, int iconColor, String value) {
    LinearLayout c = new LinearLayout(context);
    c.setOrientation(LinearLayout.VERTICAL);
    c.setGravity(Gravity.CENTER_HORIZONTAL);
    if (icon.isEmpty()) {
      View cardView = new View(context);
      cardView.setBackground(Ui.shape(context, iconColor, 2, 0, 0));
      c.addView(cardView, new LinearLayout.LayoutParams(dp(12), dp(16)));
    } else {
      TextView t = text(icon, 16, iconColor, true);
      c.addView(t, new LinearLayout.LayoutParams(-2, dp(18)));
    }
    TextView v = text(value, 15, Ui.FG, true);
    v.setPadding(0, dp(6), 0, 0);
    c.addView(v);
    return c;
  }

  View shots(String onTarget, String total, int color, int textColor) {
    LinearLayout c = new LinearLayout(context);
    c.setOrientation(LinearLayout.VERTICAL);
    c.setGravity(Gravity.CENTER);
    c.setBackground(Ui.shape(context, color, 999, 0, 0));
    c.addView(text(onTarget, 16, textColor, true));
    c.addView(text(total, 11, textColor, false));
    return c;
  }

  void general(Model m) {
    if (!m.events.isEmpty() || m.live || m.state.equals("finished") || m.state.equals("halftime")) {
      LinearLayout box = card();
      box.addView(names(m));
      box.addView(new Timeline(m), new LinearLayout.LayoutParams(-1, -2));
      add(box);
    }
    String[][] gauges = {{"possessionPct", "Posesión"}, {"totalShots", "Tiros"}, {"shotsOnTarget", "Tiros a puerta"}};
    LinearLayout row = new LinearLayout(context);
    for (String[] g : gauges) {
      Stat s = stat(m, g[0]);
      if (s == null) continue;
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, -2, 1);
      p.setMargins(row.getChildCount() == 0 ? 0 : dp(4), 0, 0, 0);
      row.addView(gauge(g[1], s), p);
    }
    if (row.getChildCount() > 0) add(row);
    if (!m.stats.isEmpty()) {
      LinearLayout box = card();
      LinearLayout icons = new LinearLayout(context);
      icons.setGravity(Gravity.CENTER_VERTICAL);
      String[] keys = {"wonCorners", "redCards", "yellowCards"};
      for (String k : keys) icons.addView(cellFor(m, k, "home"), new LinearLayout.LayoutParams(0, -2, 1));
      LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(52), dp(52));
      sp.setMargins(dp(2), 0, dp(2), 0);
      icons.addView(shots(value(m, "shotsOnTarget", "home"), value(m, "totalShots", "home"), HOME, 0xffffffff), sp);
      icons.addView(shots(value(m, "shotsOnTarget", "away"), value(m, "totalShots", "away"), AWAY, 0xff1a1200), sp);
      for (int i = keys.length - 1; i >= 0; i--) icons.addView(cellFor(m, keys[i], "away"), new LinearLayout.LayoutParams(0, -2, 1));
      box.addView(icons);
      TextView label = text("Tiros a puerta / tiros totales", 12, Ui.MUTED, false);
      label.setGravity(Gravity.CENTER);
      label.setPadding(0, dp(8), 0, 0);
      box.addView(label, new LinearLayout.LayoutParams(-1, -2));
      add(box);
    }
    if (m.events.isEmpty() && m.source.equals("espn")) empty(m.state.equals("scheduled") ? "El partido aún no ha empezado." : "Sin incidencias por ahora.");
    for (Event e : m.events) {
      LinearLayout r = new LinearLayout(context);
      r.setGravity(Gravity.CENTER_VERTICAL);
      r.setPadding(dp(12), dp(8), dp(12), dp(8));
      r.setBackground(Ui.shape(context, Ui.SURFACE, 10, 0, 0));
      boolean away = e.side.equals("away");
      TextView minuteView = text(e.minute, 14, Ui.ACC, true);
      minuteView.setMinWidth(dp(40));
      minuteView.setGravity(away ? Gravity.END : Gravity.START);
      View icon = icon(e.kind);
      LinearLayout what = new LinearLayout(context);
      what.setOrientation(LinearLayout.VERTICAL);
      what.setGravity(away ? Gravity.END : Gravity.START);
      what.addView(text(e.player.isEmpty() ? KIND.get(e.kind) : e.player, 14, Ui.FG, true));
      what.addView(text(e.kind.equals("sub") && !e.other.isEmpty() ? "Sale " + e.other : KIND.get(e.kind), 12, Ui.MUTED, false));
      LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(28), dp(28));
      ip.setMargins(dp(6), 0, dp(6), 0);
      if (away) { r.addView(what, new LinearLayout.LayoutParams(0, -2, 1)); r.addView(icon, ip); r.addView(minuteView); }
      else { r.addView(minuteView); r.addView(icon, ip); r.addView(what, new LinearLayout.LayoutParams(0, -2, 1)); }
      r.setContentDescription(e.minute + " " + KIND.get(e.kind) + " " + e.player);
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
      p.bottomMargin = dp(6);
      content.addView(r, p);
    }
    if (!m.homeForm.isEmpty() || !m.awayForm.isEmpty()) {
      LinearLayout box = card();
      TextView title = text("Últimos partidos", 14, Ui.MUTED, true);
      title.setPadding(0, 0, 0, dp(6));
      box.addView(title);
      box.addView(formRow(m.home.name, m.homeForm));
      box.addView(formRow(m.away.name, m.awayForm));
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
      p.setMargins(0, dp(4), 0, dp(10));
      content.addView(box, p);
    }
    List<String[]> facts = new ArrayList<>();
    String round = m.round.isEmpty() ? m.league : m.league.isEmpty() ? m.round : m.league + " · " + m.round;
    for (String[] fact : Arrays.asList(new String[] {"Competición", round}, new String[] {"Fecha", when(m.date, "EEEE d 'de' MMMM, HH:mm")}, new String[] {"Estadio", m.venue},
        new String[] {"Ciudad", m.city}, new String[] {"Asistencia", m.attendance > 0 ? String.format(new Locale("es", "ES"), "%,d", m.attendance) : ""},
        new String[] {"Árbitro", m.referee})) if (!fact[1].isEmpty()) facts.add(fact);
    if (!facts.isEmpty()) {
      LinearLayout box = card();
      for (String[] fact : facts) {
        LinearLayout r = new LinearLayout(context);
        r.setPadding(0, dp(5), 0, dp(5));
        r.addView(text(fact[0], 13, Ui.MUTED, false), new LinearLayout.LayoutParams(dp(100), -2));
        r.addView(text(fact[1], 14, Ui.FG, true), new LinearLayout.LayoutParams(0, -2, 1));
        box.addView(r);
      }
      add(box);
    }
    if (!m.description.isEmpty()) {
      TextView d = text(m.description, 14, 0xffd6dbe2, false);
      d.setLineSpacing(0, 1.2f);
      add(d);
    }
  }

  String value(Model m, String key, String side) {
    Stat s = stat(m, key);
    return s == null ? "0" : (side.equals("home") ? s.home : s.away).replace("%", "");
  }

  View cellFor(Model m, String key, String side) {
    String v = value(m, key, side);
    if (key.equals("wonCorners")) return cell("⚑", 0xff5ee08a, v);
    return cell("", key.equals("redCards") ? 0xffff3b3b : 0xffffd400, v);
  }

  View formRow(String name, List<Form> list) {
    LinearLayout r = new LinearLayout(context);
    r.setGravity(Gravity.CENTER_VERTICAL);
    r.setPadding(0, dp(4), 0, dp(4));
    r.addView(text(name, 14, Ui.FG, true), new LinearLayout.LayoutParams(0, -2, 1));
    for (Form f : list) {
      boolean win = f.result.equals("W") || f.result.equals("G"), draw = f.result.equals("D") || f.result.equals("E");
      TextView chip = text(win ? "V" : draw ? "E" : "D", 12, 0xffffffff, true);
      chip.setGravity(Gravity.CENTER);
      chip.setBackground(Ui.shape(context, win ? 0xff1f9d55 : draw ? 0xff6b7280 : 0xffd64545, 6, 0, 0));
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(24), dp(24));
      p.leftMargin = dp(4);
      r.addView(chip, p);
    }
    return r;
  }

  View icon(String kind) {
    if (kind.equals("yellow") || kind.equals("red")) {
      FrameLayout f = new FrameLayout(context);
      View cardView = new View(context);
      cardView.setBackground(Ui.shape(context, kind.equals("red") ? 0xffff3b3b : 0xffffd400, 2, 0, 0));
      f.addView(cardView, new FrameLayout.LayoutParams(dp(12), dp(16), Gravity.CENTER));
      return f;
    }
    TextView t = text(kind.equals("sub") ? "⇄" : kind.equals("penalty-missed") ? "✕" : "⚽", 16, kind.equals("sub") ? Ui.ACC : Ui.FG, true);
    t.setGravity(Gravity.CENTER);
    return t;
  }

  void stats(Model m) {
    if (m.stats.isEmpty()) { empty(m.state.equals("scheduled") ? "Las estadísticas aparecen cuando empieza el partido." : "No hay estadísticas de este partido."); return; }
    LinearLayout box = card();
    box.addView(names(m));
    for (Stat s : m.stats) {
      LinearLayout row = new LinearLayout(context);
      row.setPadding(0, dp(12), 0, dp(4));
      row.addView(text(s.home, 14, s.share > 0.5 ? Ui.FG : Ui.MUTED, true), new LinearLayout.LayoutParams(dp(64), -2));
      TextView label = text(s.label, 13, Ui.MUTED, false);
      label.setGravity(Gravity.CENTER);
      row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
      TextView a = text(s.away, 14, s.share < 0.5 ? Ui.FG : Ui.MUTED, true);
      a.setGravity(Gravity.END);
      row.addView(a, new LinearLayout.LayoutParams(dp(64), -2));
      box.addView(row);
      LinearLayout bars = new LinearLayout(context);
      bars.addView(bar((float) s.share, HOME, true), new LinearLayout.LayoutParams(0, dp(6), 1));
      bars.addView(new View(context), new LinearLayout.LayoutParams(dp(6), dp(6)));
      bars.addView(bar((float) (1 - s.share), AWAY, false), new LinearLayout.LayoutParams(0, dp(6), 1));
      box.addView(bars);
    }
    add(box);
  }

  View bar(float share, int color, boolean fromEnd) {
    LinearLayout track = new LinearLayout(context);
    track.setBackground(Ui.shape(context, SURFACE_2, 3, 0, 0));
    View fill = new View(context);
    fill.setBackground(Ui.shape(context, color, 3, 0, 0));
    View rest = new View(context);
    if (fromEnd) { track.addView(rest, new LinearLayout.LayoutParams(0, -1, 1 - share)); track.addView(fill, new LinearLayout.LayoutParams(0, -1, share)); }
    else { track.addView(fill, new LinearLayout.LayoutParams(0, -1, share)); track.addView(rest, new LinearLayout.LayoutParams(0, -1, 1 - share)); }
    return track;
  }

  static final int GRASS = 0xff1f7a45, CHALK = 0x47ffffff;
  static final String LINEUPS = "https://calamarmenciano.com/calamar-lineups.php";

  // Players' photos and ratings (API-Football, through the hosting): asked with the line-ups open, at
  // most every 5 minutes; the hosting keeps them too (the free plan has 100 requests a day).
  String extrasKey = ""; long extrasAt; JSONObject extras; boolean extrasBusy;

  static String extrasKey(Model m) {
    return m.home.name + "|" + m.away.name + "|" + (m.date.length() >= 10 ? m.date.substring(0, 10) : "");
  }

  void playerExtras(Model m) {
    if (m.lineups.isEmpty() || m.home.name.isEmpty() || m.away.name.isEmpty() || !m.date.matches("\\d{4}-\\d{2}-\\d{2}.*")) return;
    final String key = extrasKey(m);
    if (extrasBusy || (key.equals(extrasKey) && System.currentTimeMillis() - extrasAt < 300000)) return;
    if (!key.equals(extrasKey)) extras = null;
    extrasKey = key; extrasAt = System.currentTimeMillis(); extrasBusy = true;
    final String url = LINEUPS + "?home=" + Uri.encode(m.home.name) + "&away=" + Uri.encode(m.away.name) + "&date=" + m.date.substring(0, 10);
    new Thread(() -> {
      JSONObject found = null;
      try {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000); c.setReadTimeout(15000);
        try {
          if (c.getResponseCode() == 200) {
            try (InputStream in = c.getInputStream()) {
              JSONObject answer = new JSONObject(new String(readAll(in), "UTF-8"));
              found = answer.optJSONObject("teams");
            }
          }
        } finally { c.disconnect(); }
      } catch (Exception ignored) {}
      final JSONObject teams = found;
      handler.post(() -> {
        extrasBusy = false;
        if (!key.equals(extrasKey) || teams == null) return;
        extras = teams;
        if (model != null && tab.equals("lineups")) show(model);
      });
    }).start();
  }

  static byte[] readAll(InputStream in) throws java.io.IOException {
    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    for (int n; (n = in.read(buffer)) != -1;) out.write(buffer, 0, n);
    return out.toByteArray();
  }

  /** Photos and ratings to ESPN's players, by side and number (as withPlayerExtras() on the web). */
  static void applyExtras(Model m, JSONObject teams) {
    if (teams == null) return;
    for (Lineup l : m.lineups) {
      JSONArray list = teams.optJSONArray(l.side);
      if (list == null) continue;
      List<Player> all = new ArrayList<>(l.starters); all.addAll(l.subs);
      for (Player p : all) {
        for (int i = 0; i < list.length(); i++) {
          JSONObject x = list.optJSONObject(i);
          if (x == null || p.number.isEmpty() || !p.number.equals(x.optString("number"))) continue;
          String photo = x.optString("photo");
          p.photo = photo.startsWith("https://") ? photo : "";
          p.rating = x.isNull("rating") ? Double.NaN : x.optDouble("rating", Double.NaN);
          break;
        }
      }
    }
  }

  /** Google's colours for a rating: blue from 8, green from 7, yellow from 6, orange below. */
  static int ratingColor(double r) { return r >= 8 ? 0xffa6d1ff : r >= 7 ? 0xffc8e6c9 : r >= 6 ? 0xfffff0a8 : 0xffffd0a6; }

  /**
   * Both elevens on one pitch, as Google shows them: the home team from the top goal (its right on the
   * viewer's left), the away team from the bottom one. Then each bench.
   */
  void lineups(Model m) {
    if (m.lineups.isEmpty()) { empty(m.state.equals("scheduled") ? "Las alineaciones se publican poco antes del partido." : "No hay alineaciones de este partido."); return; }
    Lineup home = null, away = null;
    for (Lineup l : m.lineups) if (l.side.equals("home")) home = l; else away = l;
    LinearLayout pitch = new LinearLayout(context);
    pitch.setOrientation(LinearLayout.VERTICAL);
    pitch.setBackground(Ui.shape(context, GRASS, 16, 0, 0));
    pitch.setClipToOutline(true);
    if (home != null) half(pitch, home, true);
    if (home != null && away != null) {
      View line = new View(context);
      line.setBackgroundColor(CHALK);
      pitch.addView(line, new LinearLayout.LayoutParams(-1, dp(2)));
    }
    if (away != null) half(pitch, away, home == null);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.bottomMargin = dp(14);
    add(pitch);
    pitch.setLayoutParams(lp);
    for (Lineup l : m.lineups) {
      if (l.subs.isEmpty()) continue;
      LinearLayout box = card();
      LinearLayout head = new LinearLayout(context);
      head.setGravity(Gravity.CENTER_VERTICAL);
      head.addView(crest(l.team, 28), new LinearLayout.LayoutParams(dp(28), dp(28)));
      TextView name = text("Suplentes · " + l.team.name, 16, Ui.FG, true);
      name.setPadding(dp(10), 0, dp(10), 0);
      head.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
      box.addView(head);
      players(box, l.subs, l.side);
      add(box);
    }
  }

  void half(LinearLayout pitch, Lineup l, boolean top) {
    LinearLayout head = new LinearLayout(context);
    head.setGravity(Gravity.CENTER_VERTICAL);
    head.setPadding(dp(12), dp(10), dp(12), dp(10));
    head.setBackgroundColor(0x2e000000);
    head.addView(crest(l.team, 28), new LinearLayout.LayoutParams(dp(28), dp(28)));
    TextView name = text(l.team.name, 16, Ui.FG, true);
    name.setSingleLine(true); name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    name.setPadding(dp(10), 0, dp(10), 0);
    head.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
    if (!l.formation.isEmpty()) {
      TextView formation = text(l.formation, 13, 0xff134a2a, true);
      formation.setPadding(dp(10), dp(3), dp(10), dp(3));
      formation.setBackground(Ui.shape(context, 0xd9ffffff, 999, 0, 0));
      head.addView(formation);
    }
    List<List<Player>> rows = Pitch.rows(l.formation, l.starters);
    if (!top) Collections.reverse(rows);
    if (top) pitch.addView(head);
    for (List<Player> row : rows) {
      LinearLayout line = new LinearLayout(context);
      line.setPadding(dp(4), dp(10), dp(4), dp(4));
      List<Player> order = new ArrayList<>(row);
      // The away team attacks upwards: its left is the viewer's left.
      if (!top) Collections.reverse(order);
      for (Player p : order) line.addView(man(p), new LinearLayout.LayoutParams(0, -2, 1));
      pitch.addView(line);
    }
    if (!top) pitch.addView(head);
  }

  /** A player on the pitch: his shirt (or number), goals, cards and an arrow if he was changed; under it his number and name. */
  View man(Player p) {
    LinearLayout box = new LinearLayout(context);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setGravity(Gravity.CENTER_HORIZONTAL);
    FrameLayout spot = new FrameLayout(context);
    FrameLayout disc = new FrameLayout(context);
    disc.setBackground(Ui.shape(context, 0xe6ffffff, 999, 0, 0));
    TextView number = text(p.number.isEmpty() ? "·" : p.number, 16, 0xff134a2a, true);
    number.setGravity(Gravity.CENTER);
    disc.addView(number, new FrameLayout.LayoutParams(-1, -1));
    // His photo when API-Football has it; otherwise the shirt of the match; otherwise his number.
    if (!p.photo.isEmpty() || !p.shirt.isEmpty()) {
      ImageView shirt = new ImageView(context);
      boolean photo = !p.photo.isEmpty();
      shirt.setScaleType(photo ? ImageView.ScaleType.CENTER_CROP : ImageView.ScaleType.FIT_CENTER);
      if (!photo) shirt.setPadding(dp(4), dp(4), dp(4), dp(4));
      disc.setClipToOutline(true);
      disc.addView(shirt, new FrameLayout.LayoutParams(-1, -1));
      load(shirt, number, photo ? p.photo : p.shirt);
    }
    FrameLayout.LayoutParams discLp = new FrameLayout.LayoutParams(dp(44), dp(44), Gravity.CENTER);
    spot.addView(disc, discLp);
    if (p.out) spot.addView(badge("↓", 0xffc62828, 0xfffde2e1), new FrameLayout.LayoutParams(dp(18), dp(18), Gravity.TOP | Gravity.START));
    if (p.goals > 0 || p.ownGoals > 0) spot.addView(badge(p.goals > 1 ? "⚽" + p.goals : "⚽", 0xff134a2a, 0xffffffff), new FrameLayout.LayoutParams(-2, dp(18), Gravity.BOTTOM | Gravity.END));
    if (p.red > 0 || p.yellow > 0) {
      View card = new View(context);
      card.setBackground(Ui.shape(context, p.red > 0 ? 0xffe53935 : 0xfff5c518, 2, 0, 0));
      FrameLayout.LayoutParams cardLp = new FrameLayout.LayoutParams(dp(10), dp(14), Gravity.TOP | Gravity.END);
      cardLp.rightMargin = dp(4);
      spot.addView(card, cardLp);
    }
    if (!Double.isNaN(p.rating)) {
      TextView rating = text(String.format(Locale.ROOT, "%.1f", p.rating), 11, 0xff10331f, true);
      rating.setGravity(Gravity.CENTER);
      rating.setPadding(dp(5), 0, dp(5), 0);
      rating.setBackground(Ui.shape(context, ratingColor(p.rating), 999, 0, 0));
      spot.addView(rating, new FrameLayout.LayoutParams(-2, dp(16), Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL));
    }
    box.addView(spot, new LinearLayout.LayoutParams(dp(56), dp(56)));
    TextView name = text((p.number.isEmpty() ? "" : p.number + " ") + (p.shortName.isEmpty() ? p.name : p.shortName), 12, 0xffffffff, false);
    name.setSingleLine(true); name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    name.setGravity(Gravity.CENTER);
    name.setShadowLayer(dp(2), 0, dp(1), 0x80000000);
    box.addView(name, new LinearLayout.LayoutParams(-1, -2));
    StringBuilder said = new StringBuilder(p.number + " " + p.name);
    if (p.goals > 0) said.append(", ").append(p.goals).append(p.goals > 1 ? " goles" : " gol");
    if (p.red > 0) said.append(", tarjeta roja"); else if (p.yellow > 0) said.append(", tarjeta amarilla");
    if (p.out) said.append(", sustituido").append(p.subAt.isEmpty() ? "" : " en el " + p.subAt);
    if (!Double.isNaN(p.rating)) said.append(", nota ").append(String.format(Locale.ROOT, "%.1f", p.rating));
    box.setContentDescription(said);
    return box;
  }

  TextView badge(String value, int fg, int bg) {
    TextView t = text(value, 10, fg, true);
    t.setGravity(Gravity.CENTER);
    t.setPadding(dp(3), 0, dp(3), 0);
    t.setBackground(Ui.shape(context, bg, 999, 0, 0));
    return t;
  }

  void players(LinearLayout box, List<Player> list, String side) {
    for (Player p : list) {
      LinearLayout r = new LinearLayout(context);
      r.setGravity(Gravity.CENTER_VERTICAL);
      r.setPadding(0, dp(6), 0, dp(6));
      TextView number = text(p.number, 14, side.equals("home") ? HOME : AWAY, true);
      number.setGravity(Gravity.END);
      r.addView(number, new LinearLayout.LayoutParams(dp(28), -2));
      TextView name = text(p.name + (p.out ? " ↓" : "") + (p.in ? " ↑" + (p.subAt.isEmpty() ? "" : " " + p.subAt) : "")
          + (Double.isNaN(p.rating) ? "" : String.format(Locale.ROOT, "  ·  %.1f", p.rating)), 14, Ui.FG, false);
      name.setPadding(dp(10), 0, dp(8), 0);
      r.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
      r.addView(text(p.position, 12, Ui.MUTED, false));
      box.addView(r);
    }
  }

  void h2h(Model m) {
    if (m.h2h.isEmpty()) { empty("No hay enfrentamientos anteriores registrados."); return; }
    for (Meeting g : m.h2h) {
      LinearLayout box = card();
      LinearLayout top = new LinearLayout(context);
      if (g.upcoming) {
        TextView next = text("Próximo  ", 12, Ui.ACC, true);
        top.addView(next);
      }
      top.addView(text(g.upcoming && (!g.dateKnown || g.date.isEmpty()) ? "Fecha por definir" : when(g.date, "d MMM yyyy"), 12, Ui.MUTED, false), new LinearLayout.LayoutParams(0, -2, 1));
      top.addView(text(g.competition, 12, Ui.MUTED, false));
      box.addView(top);
      LinearLayout game = new LinearLayout(context);
      game.setGravity(Gravity.CENTER_VERTICAL);
      game.setPadding(0, dp(6), 0, 0);
      game.addView(text(g.home, 14, Ui.FG, false), new LinearLayout.LayoutParams(0, -2, 1));
      TextView score = text(g.score.isEmpty() ? "vs" : g.score, 16, Ui.FG, true);
      score.setPadding(dp(10), 0, dp(10), 0);
      game.addView(score);
      TextView away = text(g.away, 14, Ui.FG, false);
      away.setGravity(Gravity.END);
      game.addView(away, new LinearLayout.LayoutParams(0, -2, 1));
      box.addView(game);
      add(box);
    }
  }

  void failed(Model base) {
    if (model != null && model.source.equals("espn")) return;
    base.note = "No se pudieron cargar los datos del partido. Se volverá a intentar en unos segundos.";
    show(base);
  }
}
