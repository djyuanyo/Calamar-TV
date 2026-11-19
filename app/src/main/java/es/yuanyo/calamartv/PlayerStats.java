package es.yuanyo.calamartv;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** ESPN's public player totals, scoped to the selected fixture and competition season. */
final class PlayerStats {
  private PlayerStats() {}
  static final String CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/";
  static final String[][] STATS = {
    {"appearances", "Partidos", ""},
    {"starts", "Titularidades", ""},
    {"minutes", "Minutos", ""},
    {"totalGoals", "Goles", ""},
    {"goalAssists", "Asistencias", ""},
    {"totalShots", "Tiros", ""},
    {"shotsOnTarget", "Tiros a puerta", ""},
    {"shotAssists", "Ocasiones creadas", ""},
    {"totalPasses", "Pases", ""},
    {"accuratePasses", "Pases completados", ""},
    {"passPct", "Precisión de pase", ""},
    {"touches", "Toques", ""},
    {"totalCrosses", "Centros", ""},
    {"accurateCrosses", "Centros completados", ""},
    {"totalLongBalls", "Balones largos", ""},
    {"totalTackles", "Entradas", ""},
    {"effectiveTackles", "Entradas ganadas", ""},
    {"interceptions", "Intercepciones", ""},
    {"recoveries", "Recuperaciones", ""},
    {"totalClearance", "Despejes", ""},
    {"blockedShots", "Tiros bloqueados", ""},
    {"duelsWon", "Duelos ganados", ""},
    {"duelsLost", "Duelos perdidos", ""},
    {"foulsCommitted", "Faltas cometidas", ""},
    {"foulsSuffered", "Faltas recibidas", ""},
    {"offsides", "Fueras de juego", ""},
    {"yellowCards", "Tarjetas amarillas", ""},
    {"redCards", "Tarjetas rojas", ""},
    {"ownGoals", "Goles en propia puerta", ""},
    {"saves", "Paradas", "keeper"},
    {"goalsConceded", "Goles encajados", "keeper"},
    {"cleanSheet", "Porterías a cero", "keeper"},
    {"penaltyKicksSaved", "Penaltis parados", "keeper"},
    {"savePct", "Porcentaje de paradas", "keeper"},
  };
  static final class Row {
    final String key, label, value;
    Row(String key, String label, String value) { this.key = key; this.label = label; this.value = value; }
  }
  private static final class Cached {
    final JSONObject data;
    final long at = System.currentTimeMillis();
    Cached(JSONObject data) { this.data = data; }
  }
  private static final Map<String, Cached> cache = new LinkedHashMap<>();

  static String base(MatchCenter.Model match, MatchCenter.Player player) {
    if (!match.leagueCode.matches("[a-z0-9]+(?:\\.[a-z0-9_]+)+") || !player.id.matches("\\d+")) return "";
    return CORE + match.leagueCode;
  }
  static String matchUrl(MatchCenter.Model match, MatchCenter.Player player) {
    String base = base(match, player);
    if (base.isEmpty() || !match.id.matches("\\d+") || !player.teamId.matches("\\d+")) return "";
    return base + "/events/" + match.id + "/competitions/" + match.id + "/competitors/"
        + player.teamId + "/roster/" + player.id + "/statistics/0?lang=es&region=es";
  }
  static String seasonUrl(MatchCenter.Model match, MatchCenter.Player player) {
    String base = base(match, player);
    if (base.isEmpty() || !match.seasonYear.matches("20\\d{2}") || !match.seasonType.matches("\\d+")) return "";
    return base + "/seasons/" + match.seasonYear + "/types/" + match.seasonType
        + "/athletes/" + player.id + "/statistics/0?lang=es&region=es";
  }

  static List<Row> rows(JSONObject data, String position) {
    JSONArray stats = new JSONArray();
    JSONObject splits = data == null ? null : data.optJSONObject("splits");
    JSONArray categories = splits == null ? null : splits.optJSONArray("categories");
    for (int i = 0; categories != null && i < categories.length(); i++) {
      JSONObject category = categories.optJSONObject(i);
      JSONArray values = category == null ? null : category.optJSONArray("stats");
      for (int j = 0; values != null && j < values.length(); j++) stats.put(values.opt(j));
    }
    return rows(stats, position);
  }

  static List<Row> rows(JSONArray stats, String position) {
    Map<String, JSONObject> byName = new HashMap<>();
    for (int i = 0; stats != null && i < stats.length(); i++) {
      JSONObject value = stats.optJSONObject(i);
      if (value != null) byName.put(value.optString("name"), value);
    }
    List<Row> rows = new ArrayList<>();
    for (String[] definition : STATS) {
      JSONObject stat = byName.get(definition[0]);
      if (stat == null || (!definition[2].isEmpty() && !position.matches("(?i)G|GK"))) continue;
      String value = stat.optString("displayValue", stat.optString("value", ""));
      if (value.isEmpty() || value.equals("null") || value.equals("-")) continue;
      try {
        double number = Double.parseDouble(value.replace(",", ".").replace("%", ""));
        if (Double.isNaN(number) || Double.isInfinite(number)) continue;
        if (definition[0].endsWith("Pct")) {
          number = stat.optDouble("value", number);
          if (number >= 0 && number <= 1) number *= 100;
          java.text.NumberFormat format = java.text.NumberFormat.getNumberInstance(Locale.forLanguageTag("es-ES"));
          format.setMaximumFractionDigits(1);
          value = format.format(number) + "%";
        }
      } catch (NumberFormatException invalid) { continue; }
      rows.add(new Row(definition[0], definition[1], value));
    }
    return rows;
  }

  static JSONObject fetch(String address) throws Exception {
    Cached saved;
    synchronized (cache) { saved = cache.get(address); }
    if (saved != null && System.currentTimeMillis() - saved.at < 60000) return saved.data;
    HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
    connection.setConnectTimeout(5000);
    connection.setReadTimeout(12000);
    connection.setRequestProperty("Accept", "application/json");
    try {
      int status = connection.getResponseCode();
      if (status == 404) return null;
      if (status != 200) throw new IOException("No se pudieron cargar las estadísticas.");
      JSONObject data;
      try (InputStream input = connection.getInputStream()) { data = new JSONObject(Io.read(input)); }
      synchronized (cache) {
        cache.put(address, new Cached(data));
        if (cache.size() > 64) cache.remove(cache.keySet().iterator().next());
      }
      return data;
    } finally { connection.disconnect(); }
  }
}
