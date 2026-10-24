package es.yuanyo.calamartv;

import java.text.*;
import java.util.*;
import org.json.*;

/** Event schedule and relationships shared by administration and public cards. */
final class SportsCatalog {
  static final String[] STATES = {"scheduled", "live", "finished"};
  static final String[] STATE_NAMES = {"Programado", "En juego", "Finalizado"};
  static String stateName(String state) {
    for (int i=0;i<STATES.length;i++) if (STATES[i].equals(state)) return STATE_NAMES[i];
    return STATE_NAMES[0];
  }
  static final String LIVE = "En directo";
  /** Card badge: the start date and time until the event begins, then «En directo» or «Finalizado». */
  static String label(String status, String startAt, long now) {
    if ("finished".equals(status)) return stateName(status);
    long start = instant(startAt);
    if (start != Long.MAX_VALUE && now < start) {
      SimpleDateFormat f = new SimpleDateFormat("EEE d MMM · HH:mm", Locale.forLanguageTag("es-ES"));
      f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
      return f.format(new Date(start)).replace(".", "").replace(",", "");
    }
    if (start != Long.MAX_VALUE || "live".equals(status)) return LIVE;
    return stateName(status);
  }
  static SimpleDateFormat dateFormat(String pattern) {
    SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.ROOT);
    f.setLenient(false); f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid")); return f;
  }
  static long instant(String iso) {
    if (iso == null || iso.isEmpty()) return Long.MAX_VALUE;
    try {
      String pattern = iso.contains(".") ? "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" : "yyyy-MM-dd'T'HH:mm:ss'Z'";
      SimpleDateFormat f = dateFormat(pattern); f.setTimeZone(TimeZone.getTimeZone("UTC"));
      ParsePosition pos = new ParsePosition(0); Date result = f.parse(iso, pos);
      return result != null && pos.getIndex() == iso.length() ? result.getTime() : Long.MAX_VALUE;
    } catch (Exception invalid) { return Long.MAX_VALUE; }
  }
  static String fromMadrid(String value) throws JSONException {
    ParsePosition pos = new ParsePosition(0);
    Date date = dateFormat("yyyy-MM-dd HH:mm").parse(value, pos);
    if (date == null || pos.getIndex() != value.length()) throw new JSONException("Fecha u hora no válida (horario de Madrid)");
    SimpleDateFormat utc = dateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"); utc.setTimeZone(TimeZone.getTimeZone("UTC"));
    return utc.format(date);
  }
  static String local(String iso, String pattern) {
    long value = instant(iso); return value == Long.MAX_VALUE ? "" : dateFormat(pattern).format(new Date(value));
  }
  static JSONObject find(JSONArray list, String id) {
    if (list != null) for (int i=0;i<list.length();i++) { JSONObject item=list.optJSONObject(i); if(item!=null && item.optString("id").equals(id)) return item; }
    return null;
  }
  static String meta(JSONObject event, JSONObject data) {
    List<String> parts = new ArrayList<>();
    JSONObject league = find(data.optJSONArray("leagues"), event.optString("leagueId"));
    if (league != null) parts.add(league.optString("name"));
    String date=local(event.optString("startAt"), "dd/MM/yyyy HH:mm"); if(!date.isEmpty()) parts.add(date);
    for (String key : new String[]{"round","venue"}) if(!event.optString(key).isEmpty()) parts.add(event.optString(key));
    return androidFreeJoin(parts);
  }
  private static String androidFreeJoin(List<String> parts) { StringBuilder s=new StringBuilder(); for(String p:parts) {if(s.length()>0)s.append(" · ");s.append(p);} return s.toString(); }
  /** Same as slugify() in web/catalog.js: "Final de Copa: Ñora" -> "final-de-copa-nora". */
  static String slugify(String text) {
    String plain = Normalizer.normalize(text == null ? "" : text, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    String slug = plain.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
    return slug.isEmpty() ? "canal" : slug;
  }

  /** Link name of each event and imported match, as eventSlugs() in web/catalog.js: date order, repeated names get -2, -3… */
  static Map<String, String> slugs(JSONObject data) {
    List<JSONObject> list = new ArrayList<>(), imported = new ArrayList<>();
    for (JSONObject e : Competitions.all(data)) (e.optBoolean("imported") ? imported : list).add(e);
    Comparator<JSONObject> order = (a, b) -> {
      int cmp = Long.compare(instant(a.optString("startAt")), instant(b.optString("startAt")));
      return cmp != 0 ? cmp : a.optString("id").compareTo(b.optString("id"));
    };
    // Imported matches come after the events, so they never change an event's link.
    Collections.sort(list, order); Collections.sort(imported, order); list.addAll(imported);
    Map<String, String> out = new LinkedHashMap<>();
    Set<String> used = new HashSet<>();
    for (JSONObject event : list) {
      String base = slugify(event.optString("name")), slug = base;
      for (int n = 2; used.contains(slug); n++) slug = base + "-" + n;
      used.add(slug);
      out.put(event.optString("id"), slug);
    }
    return out;
  }

  /** Shared link: the public web publishes evento/<slug>/ with the cover and name for WhatsApp. */
  static final String WEB = "https://djyuanyo.github.io/Calamar-TV/";
  static String link(String slug) { return WEB + "evento/" + slug + "/"; }
  static void validate(JSONObject data) throws JSONException {
    Map<String, Set<String>> sets = new HashMap<>();
    for (String kind : new String[]{"leagues","teams"}) {
      JSONArray list = data.has(kind) ? data.getJSONArray(kind) : new JSONArray();
      Set<String> ids=new HashSet<>(); sets.put(kind,ids);
      for(int i=0;i<list.length();i++) {
        JSONObject item=list.getJSONObject(i); String id=item.getString("id");
        if(id.isEmpty() || !ids.add(id) || item.getString("name").trim().isEmpty() || (!item.optString("logo").isEmpty() && !SharedCatalog.validCover(item.getString("logo"))) || (!item.optString("background").isEmpty() && !SharedCatalog.validCover(item.getString("background")))) throw new JSONException("Liga o equipo incompleto o duplicado");
      }
    }
    JSONArray teams=data.optJSONArray("teams");
    if(teams!=null)for(int i=0;i<teams.length();i++) {String id=teams.getJSONObject(i).optString("leagueId");if(!id.isEmpty()&&!sets.get("leagues").contains(id))throw new JSONException("La liga del equipo no existe");}
    JSONArray events=data.optJSONArray("events");if(events==null)return;
    for(int i=0;i<events.length();i++) {
      JSONObject e=events.getJSONObject(i);String time=e.optString("startAt");
      if(!time.isEmpty() && (!time.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z") || instant(time)==Long.MAX_VALUE))throw new JSONException("Fecha no válida");
      if(!e.optString("matchUrl").isEmpty()) {
        try { MatchScores.google(e.getString("matchUrl")); } catch(Exception invalid) { throw new JSONException("Enlace de Google no válido"); }
        if(!e.optString("matchId").matches("\\d{1,20}") || instant(e.optString("matchDate"))==Long.MAX_VALUE)throw new JSONException("Comprueba el partido antes de guardar");
      }
      if(e.has("featured") && !(e.get("featured") instanceof Boolean))throw new JSONException("Destacado no válido");
      String league=e.optString("leagueId"), home=e.optString("homeTeamId"), away=e.optString("awayTeamId");
      if((!league.isEmpty()&&!sets.get("leagues").contains(league)) || (!home.isEmpty()&&!sets.get("teams").contains(home)) || (!away.isEmpty()&&!sets.get("teams").contains(away)))throw new JSONException("Liga o equipo no existente");
      if(!home.isEmpty()&&home.equals(away))throw new JSONException("Local y visitante deben ser diferentes");
      if(!e.optString("status").isEmpty()&&!Arrays.asList(STATES).contains(e.getString("status")))throw new JSONException("Estado no válido");
      for(String key:new String[]{"season","round","venue","description"})if(e.has(key)&&(!(e.get(key) instanceof String)||e.getString(key).length()>4000))throw new JSONException("Detalles no válidos");
    }
  }
}
