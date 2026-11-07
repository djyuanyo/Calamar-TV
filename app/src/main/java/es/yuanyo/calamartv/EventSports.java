package es.yuanyo.calamartv;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Sport identity shared with web/event-sports.js and the bundled data/sports.json. */
final class EventSports {
  static final class Tab {
    final String id, name, icon;
    final int count;
    Tab(String id, String name, String icon, int count) {
      this.id = id; this.name = name; this.icon = icon; this.count = count;
    }
  }
  final List<JSONObject> sports = new ArrayList<>();
  final Map<String, String> aliases = new HashMap<>();
  final JSONObject leagues;

  EventSports(JSONObject definitions) {
    JSONArray list = definitions.optJSONArray("sports");
    for (int i = 0; list != null && i < list.length(); i++) {
      JSONObject sport = list.optJSONObject(i);
      if (sport == null) continue;
      sports.add(sport);
      String id = sport.optString("id");
      aliases.put(key(id), id);
      aliases.put(key(sport.optString("name")), id);
      JSONArray values = sport.optJSONArray("aliases");
      for (int j = 0; values != null && j < values.length(); j++) aliases.put(key(values.optString(j)), id);
    }
    JSONObject known = definitions.optJSONObject("leagues");
    leagues = known == null ? new JSONObject() : known;
  }

  static String key(String value) {
    return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFD).replaceAll("\\p{M}", "")
        .toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
  }

  String sport(Catalog.Channel event, JSONObject custom) {
    JSONObject league = SportsCatalog.find(custom == null ? null : custom.optJSONArray("leagues"), event.leagueId);
    String explicit = event.sport.isEmpty() && league != null ? league.optString("sport") : event.sport;
    if (!explicit.isEmpty()) {
      String id = aliases.get(key(explicit));
      return id == null ? "other" : id;
    }
    if ((league != null && !league.optString("espn").isEmpty()) || !event.matchUrl.isEmpty()) return "soccer";
    return leagues.optString(key(league == null ? "" : league.optString("name")), "other");
  }

  List<Tab> tabs(List<Catalog.Channel> events, JSONObject custom) {
    Map<String, Integer> counts = new HashMap<>();
    for (Catalog.Channel event : events) {
      String id = sport(event, custom);
      counts.put(id, counts.getOrDefault(id, 0) + 1);
    }
    List<Tab> out = new ArrayList<>();
    out.add(new Tab("all", "Todos", "", events.size()));
    for (JSONObject sport : sports) {
      String id = sport.optString("id");
      if (counts.containsKey(id)) out.add(new Tab(id, sport.optString("name"), sport.optString("icon"), counts.get(id)));
    }
    if (counts.containsKey("other") && !aliases.containsKey("other"))
      out.add(new Tab("other", "Otros deportes", "🏅", counts.get("other")));
    return out;
  }
}
