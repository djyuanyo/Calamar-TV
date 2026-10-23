package es.yuanyo.calamartv;

import java.net.URLEncoder;
import java.util.*;
import org.json.*;

/**
 * Imported competitions (web/competitions.js): the catalog's «fixtures» are a league's upcoming
 * matches, each shown as an event whose name and Google link come from its teams. Viewers see the
 * Monday-to-Sunday week of each league's next match; without a channel they say «Canal por confirmar».
 */
final class Competitions {
  private Competitions() {}
  static final String PENDING = "Canal por confirmar";
  /** A match counts as over this long after kick-off when ESPN has not said it ended. */
  static final long MATCH_SPAN_MS = 4L * 3600000L;

  static String googleSearch(String home, String away) {
    try {
      return "https://www.google.com/search?q=" + URLEncoder.encode(home + " vs " + away, "UTF-8").replace("+", "%20");
    } catch (java.io.UnsupportedEncodingException impossible) { throw new IllegalStateException(impossible); }
  }

  /** A fixture as an event, as fixtureEvent() in web/competitions.js. */
  static JSONObject event(JSONObject fixture, JSONObject data) {
    try {
      JSONObject home = SportsCatalog.find(data.optJSONArray("teams"), fixture.optString("homeTeamId"));
      JSONObject away = SportsCatalog.find(data.optJSONArray("teams"), fixture.optString("awayTeamId"));
      JSONObject league = SportsCatalog.find(data.optJSONArray("leagues"), fixture.optString("leagueId"));
      String h = home != null ? home.optString("name") : "Local", a = away != null ? away.optString("name") : "Visitante";
      JSONObject e = new JSONObject(fixture.toString());
      if (!e.has("season") && league != null && !league.optString("season").isEmpty()) e.put("season", league.optString("season"));
      if (e.optString("name").isEmpty()) e.put("name", h + " vs " + a);
      if (e.optString("matchUrl").isEmpty()) e.put("matchUrl", googleSearch(h, a));
      if (e.optString("matchDate").isEmpty()) e.put("matchDate", e.optString("startAt"));
      if (!e.has("cover")) e.put("cover", "");
      if (!e.has("channelId")) e.put("channelId", "");
      return e.put("imported", true);
    } catch (JSONException broken) { return new JSONObject(); }
  }

  /** Events, then imported matches as events. */
  static List<JSONObject> all(JSONObject data) {
    List<JSONObject> out = new ArrayList<>();
    if (data == null) return out;
    JSONArray events = data.optJSONArray("events"), fixtures = data.optJSONArray("fixtures");
    if (events != null) for (int i = 0; i < events.length(); i++) if (events.optJSONObject(i) != null) out.add(events.optJSONObject(i));
    if (fixtures != null) for (int i = 0; i < fixtures.length(); i++) if (fixtures.optJSONObject(i) != null) out.add(event(fixtures.optJSONObject(i), data));
    return out;
  }

  /** The event or the imported match (as an event) with this id. */
  static JSONObject find(JSONObject data, String id) {
    for (JSONObject e : all(data)) if (e.optString("id").equals(id)) return e;
    return null;
  }

  /** Monday of the Madrid week of an instant, as «yyyy-MM-dd». */
  static String week(long instant) {
    Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Europe/Madrid"), Locale.ROOT);
    c.setTimeInMillis(instant);
    int back = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7;
    c.add(Calendar.DAY_OF_MONTH, -back);
    return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
  }

  /** Imported matches not yet over in the week of their league's next match (weekFixtures() on the web). */
  static Set<String> shownWeek(List<JSONObject> imported, long now) {
    Map<String, String> first = new HashMap<>();
    List<JSONObject> live = new ArrayList<>();
    for (JSONObject e : imported) {
      long start = SportsCatalog.instant(e.optString("startAt"));
      if (start == Long.MAX_VALUE || start + MATCH_SPAN_MS <= now) continue;
      live.add(e);
      String key = week(start), league = e.optString("leagueId"), old = first.get(league);
      if (old == null || key.compareTo(old) < 0) first.put(league, key);
    }
    Set<String> out = new HashSet<>();
    for (JSONObject e : live)
      if (week(SportsCatalog.instant(e.optString("startAt"))).equals(first.get(e.optString("leagueId")))) out.add(e.optString("id"));
    return out;
  }

  /** Checks the imported matches, as validateFixtures() on the web. */
  static void validate(JSONObject data, Set<String> channels, Set<String> eventIds) throws JSONException {
    if (!data.has("fixtures")) return;
    JSONArray list = data.getJSONArray("fixtures");
    if (list.length() > 3000) throw new JSONException("Demasiados partidos importados");
    Set<String> leagues = ids(data.optJSONArray("leagues")), teams = ids(data.optJSONArray("teams")), seen = new HashSet<>();
    for (int i = 0; i < list.length(); i++) {
      JSONObject f = list.getJSONObject(i);
      String id = f.getString("id"), home = f.optString("homeTeamId"), away = f.optString("awayTeamId");
      if (id.isEmpty() || !seen.add(id) || eventIds.contains(id)) throw new JSONException("Hay un partido importado repetido");
      if (!leagues.contains(f.optString("leagueId")) || !teams.contains(home) || !teams.contains(away) || home.equals(away))
        throw new JSONException("La liga o los equipos de un partido importado no existen");
      String time = f.optString("startAt");
      if (!time.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z") || SportsCatalog.instant(time) == Long.MAX_VALUE)
        throw new JSONException("La fecha de un partido importado no es válida");
      if (!f.optString("matchId").matches("\\d{1,20}")) throw new JSONException("Un partido importado no tiene su número de ESPN");
      if (!f.optString("matchUrl").isEmpty()) {
        try { MatchScores.google(f.getString("matchUrl")); } catch (Exception invalid) { throw new JSONException("Enlace de Google no válido"); }
      }
      if (!f.optString("channelId").isEmpty() && !channels.contains(f.optString("channelId"))) throw new JSONException("El canal de un partido importado no existe");
      if (!f.optString("cover").isEmpty() && !SharedCatalog.validCover(f.optString("cover"))) throw new JSONException("La portada de un partido importado no es válida");
      if (f.has("name") && (!(f.get("name") instanceof String) || f.getString("name").trim().isEmpty())) throw new JSONException("Nombre de partido no válido");
      for (String key : new String[] {"round", "season", "venue", "description", "status"})
        if (f.has(key) && (!(f.get(key) instanceof String) || f.getString(key).length() > 4000)) throw new JSONException("Detalles de partido no válidos");
      if (f.has("featured") && !(f.get("featured") instanceof Boolean)) throw new JSONException("Destacado no válido");
    }
  }

  private static Set<String> ids(JSONArray list) {
    Set<String> out = new HashSet<>();
    if (list != null) for (int i = 0; i < list.length(); i++) if (list.optJSONObject(i) != null) out.add(list.optJSONObject(i).optString("id"));
    return out;
  }
}
