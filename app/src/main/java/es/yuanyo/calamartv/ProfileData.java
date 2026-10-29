package es.yuanyo.calamartv;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * A profile's own data, the same as on the web (profiles.js): «Mi lista», likes, favourite channels and
 * what it played, each as { key: {page, item, at…} } with web pages («peliculas», «series», «documentales»).
 */
final class ProfileData {
  private ProfileData() {}

  static final int MAX_PROFILES = 5;
  static final int WATCHED_LIMIT = 200;
  static final String[] COLORS = {"#e50914", "#f5a623", "#2ea043", "#1f6feb", "#a371f7", "#db61a2"};

  static JSONObject empty() {
    try {
      return new JSONObject().put("list", new JSONObject()).put("ratings", new JSONObject())
          .put("favorites", new JSONObject()).put("watched", new JSONObject()).put("updatedAt", 0);
    } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
  }

  /** Missing parts filled in (a copy saved by an older web or app). */
  static JSONObject valid(JSONObject data) {
    JSONObject out = empty();
    if (data == null) return out;
    try {
      for (String part : new String[] {"list", "ratings", "favorites", "watched"})
        if (data.optJSONObject(part) != null) out.put(part, new JSONObject(data.getJSONObject(part).toString()));
      out.put("updatedAt", data.optLong("updatedAt"));
    } catch (JSONException broken) { return empty(); }
    return out;
  }

  /** The copy changed last wins (this device's or the account's). */
  static JSONObject newer(JSONObject a, JSONObject b) {
    if (b == null) return a == null ? empty() : a;
    if (a == null) return b;
    return b.optLong("updatedAt") > a.optLong("updatedAt") ? b : a;
  }

  static String key(String page, String item) { return page + "/" + item; }

  /** A new profile with a short id the rules accept («main» for the first one). */
  static JSONObject newProfile(List<JSONObject> profiles, String name, String color, Random random) {
    String clean = name == null ? "" : name.trim();
    if (clean.length() > 24) clean = clean.substring(0, 24);
    if (clean.isEmpty()) throw new IllegalArgumentException("Escribe un nombre para el perfil.");
    if (profiles.size() >= MAX_PROFILES) throw new IllegalArgumentException("Cada cuenta puede tener hasta " + MAX_PROFILES + " perfiles.");
    for (JSONObject p : profiles)
      if (p.optString("name").toLowerCase(new Locale("es")).equals(clean.toLowerCase(new Locale("es"))))
        throw new IllegalArgumentException("Ya hay un perfil con ese nombre.");
    String id = profiles.isEmpty() ? "main" : "";
    while (id.isEmpty() || has(profiles, id)) id = "p" + Long.toString((long) (random.nextDouble() * Math.pow(36, 6)), 36);
    boolean known = false;
    for (String c : COLORS) if (c.equals(color)) known = true;
    try {
      return new JSONObject().put("id", id).put("name", clean).put("color", known ? color : COLORS[profiles.size() % COLORS.length]);
    } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
  }

  private static boolean has(List<JSONObject> profiles, String id) {
    for (JSONObject p : profiles) if (id.equals(p.optString("id"))) return true;
    return false;
  }

  static List<JSONObject> profiles(JSONObject account) {
    List<JSONObject> out = new ArrayList<>();
    JSONArray list = account == null ? null : account.optJSONArray("profiles");
    if (list != null) for (int i = 0; i < list.length(); i++) if (list.optJSONObject(i) != null) out.add(list.optJSONObject(i));
    return out;
  }

  private static JSONObject copy(JSONObject data) {
    try { return new JSONObject(valid(data).toString()); } catch (JSONException impossible) { return empty(); }
  }

  private static JSONObject part(JSONObject data, String name) {
    return data.optJSONObject(name);
  }

  static JSONObject toggleList(JSONObject data, String page, String item, long now) {
    JSONObject next = copy(data);
    try {
      JSONObject list = part(next, "list");
      String key = key(page, item);
      if (list.has(key)) list.remove(key); else list.put(key, new JSONObject().put("page", page).put("item", item).put("at", now));
      next.put("updatedAt", now);
    } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    return next;
  }

  /** 1 «Me gusta», -1 «No me gusta»; the same again clears it. */
  static JSONObject rate(JSONObject data, String page, String item, int value, long now) {
    JSONObject next = copy(data);
    try {
      JSONObject ratings = part(next, "ratings");
      String key = key(page, item);
      JSONObject old = ratings.optJSONObject(key);
      if (value == 0 || (old != null && old.optInt("value") == value)) ratings.remove(key);
      else ratings.put(key, new JSONObject().put("page", page).put("item", item).put("value", value).put("at", now));
      next.put("updatedAt", now);
    } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    return next;
  }

  static JSONObject toggleFavorite(JSONObject data, String channel, long now) {
    JSONObject next = copy(data);
    try {
      JSONObject favorites = part(next, "favorites");
      if (favorites.has(channel)) favorites.remove(channel); else favorites.put(channel, new JSONObject().put("at", now));
      next.put("updatedAt", now);
    } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    return next;
  }

  /** What the profile played (one entry per film or series, the latest 200), for «Recomendado para ti». */
  static JSONObject markWatched(JSONObject data, String page, String item, long now) {
    JSONObject next = copy(data);
    try {
      JSONObject watched = part(next, "watched");
      watched.put(key(page, item), new JSONObject().put("page", page).put("item", item).put("at", now));
      List<JSONObject> all = entries(next, "watched");
      for (int i = WATCHED_LIMIT; i < all.size(); i++) watched.remove(key(all.get(i).optString("page"), all.get(i).optString("item")));
      next.put("updatedAt", now);
    } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    return next;
  }

  /** The entries of a part, the latest first. */
  static List<JSONObject> entries(JSONObject data, String name) {
    List<JSONObject> out = new ArrayList<>();
    JSONObject part = data == null ? null : data.optJSONObject(name);
    if (part == null) return out;
    for (Iterator<String> keys = part.keys(); keys.hasNext();) {
      JSONObject e = part.optJSONObject(keys.next());
      if (e != null) out.add(e);
    }
    Collections.sort(out, (a, b) -> Long.compare(b.optLong("at"), a.optLong("at")));
    return out;
  }

  static boolean inList(JSONObject data, String page, String item) {
    return data != null && data.optJSONObject("list") != null && data.optJSONObject("list").has(key(page, item));
  }

  static int rating(JSONObject data, String page, String item) {
    JSONObject r = data == null || data.optJSONObject("ratings") == null ? null : data.optJSONObject("ratings").optJSONObject(key(page, item));
    return r == null ? 0 : r.optInt("value");
  }

  static JSONObject lastLiked(JSONObject data) {
    for (JSONObject r : entries(data, "ratings")) if (r.optInt("value") > 0) return r;
    return null;
  }

  static List<String> favorites(JSONObject data) {
    List<String> out = new ArrayList<>();
    JSONObject part = data == null ? null : data.optJSONObject("favorites");
    if (part != null) for (Iterator<String> keys = part.keys(); keys.hasNext();) out.add(keys.next());
    return out;
  }
}
