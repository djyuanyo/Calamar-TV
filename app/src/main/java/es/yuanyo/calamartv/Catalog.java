package es.yuanyo.calamartv;

import java.util.*;
import org.json.*;

/**
 * Shared catalog: TDT channels (data/tdt.json) plus the administrator's channels and settings
 * (data/custom.json). web/catalog.js applies the same rules so the web and the app match.
 */
public final class Catalog {
  private Catalog() {}

  public static final String OWN_GROUP = "Calamar TV";
  public static final List<String> GROUP_ORDER =
      Arrays.asList(
          OWN_GROUP, "Generalistas", "Deportes", "Informativos", "Infantiles", "Música",
          "Autonómicos");

  /** Card background of each category until the administrator picks another one (as in web/catalog.js). */
  static final Map<String, String> CATEGORY_COLORS = new HashMap<>();
  static {
    CATEGORY_COLORS.put(OWN_GROUP, "#5a6b12"); CATEGORY_COLORS.put("Generalistas", "#1f4f8f");
    CATEGORY_COLORS.put("Deportes", "#1d7a40"); CATEGORY_COLORS.put("Informativos", "#8f2c2c");
    CATEGORY_COLORS.put("Infantiles", "#b35c14"); CATEGORY_COLORS.put("Música", "#6a2f8f");
    CATEGORY_COLORS.put("Autonómicos", "#1c7373");
  }
  private static final String[] EXTRA_COLORS = {"#7a5418", "#2d5a8a", "#8a2d63", "#4a6b2a", "#5c3d8a", "#8a4a2d", "#2d7a6b", "#6b6b2d"};

  static String defaultColor(String name) {
    String color = CATEGORY_COLORS.get(name);
    return color != null ? color : EXTRA_COLORS[Palette.hue(name) % EXTRA_COLORS.length];
  }

  /** A category: `id` is what channels store, `name` is shown, `color` is the card background. */
  public static final class Category {
    public final String id, name, color;
    Category(String id, String name, String color) { this.id = id; this.name = name; this.color = color; }
  }

  /** The administrator's categories in order (`categories`), else the older `groupOrder` and the defaults. */
  public static List<Category> categories(JSONObject custom) {
    List<Category> out = new ArrayList<>();
    JSONArray saved = custom == null ? null : custom.optJSONArray("categories");
    if (saved != null) {
      for (int i = 0; i < saved.length(); i++) {
        JSONObject c = saved.optJSONObject(i);
        if (c != null) out.add(new Category(c.optString("id"), c.optString("name"), c.optString("color")));
      }
      return out;
    }
    LinkedHashSet<String> names = new LinkedHashSet<>();
    JSONArray order = custom == null ? null : custom.optJSONArray("groupOrder");
    if (order != null) for (int i = 0; i < order.length(); i++) names.add(order.optString(i));
    names.addAll(GROUP_ORDER);
    for (String g : names) out.add(new Category(g, g, defaultColor(g)));
    return out;
  }

  /** The category of a stored group: by id, else by shown name, else a new one with its default colour. */
  static Category resolve(String group, List<Category> list) {
    for (Category c : list) if (c.id.equals(group)) return c;
    for (Category c : list) if (c.name.equals(group)) return c;
    return new Category(group, group, defaultColor(group));
  }

  public static final class Channel {
    public final int color;
    public final String category;
    public final String id, name, group, region, logo, web, cover, channelId, meta, startAt, status, leagueId, matchUrl, matchId;
    /** Events without a cover: the league's background and both crests. */
    public final String background, homeLogo, awayLogo, leagueLogo;
    public final boolean highlighted;
    /** An imported match without a channel yet («Canal por confirmar»): it opens the match alone. */
    public final boolean pending;
    public final boolean event;
    public final List<String> streams;
    public final boolean geo, own;

    Channel(JSONObject o, boolean own) {
      this(o, own, null);
    }

    Channel(JSONObject o, boolean own, List<Category> categories) {
      this.own = own;
      event = o.optBoolean("event");
      cover = o.optString("cover");
      background = image(o.optString("background")); homeLogo = image(o.optString("homeLogo")); awayLogo = image(o.optString("awayLogo")); leagueLogo = image(o.optString("leagueLogo"));
      pending = o.optBoolean("pending");
      channelId = o.optString("channelId", o.optString("id"));
      leagueId = o.optString("leagueId");
      matchUrl = o.optString("matchUrl"); matchId = o.optString("matchId");
      meta = o.optString("meta"); startAt = o.optString("startAt"); status = o.optString("status", "scheduled");
      highlighted = o.optBoolean("featured");
      id = o.optString("id");
      name = o.optString("name", "Canal");
      String g = o.optString("group").trim();
      category = g.isEmpty() ? (own ? OWN_GROUP : "Otros") : g;
      Category shown = resolve(category, categories == null ? Catalog.categories(null) : categories);
      group = shown.name;
      color = Palette.parse(shown.color);
      region = o.optString("region");
      logo = https(o.optString("logo"));
      web = https(o.optString("web"));
      List<String> s = new ArrayList<>();
      JSONArray a = o.optJSONArray("streams");
      if (a != null)
        for (int i = 0; i < a.length(); i++) {
          String url = UserChannels.normalize(a.optString(i));
          if (url != null && !s.contains(url)) s.add(url);
        }
      streams = Collections.unmodifiableList(s);
      geo = o.optBoolean("geo");
    }

    public boolean playable() {
      return !streams.isEmpty();
    }
  }

  private static String image(String url) {
    return url != null && (url.startsWith("https://") || url.startsWith("data:image/")) ? url : "";
  }

  private static String https(String url) {
    return url != null && url.startsWith("https://") ? url : "";
  }

  /** Administrator channels first, then TDT channels not hidden by the administrator. */
  public static List<Channel> merge(JSONObject tdt, JSONObject custom) {
    Set<String> hidden = strings(custom == null ? null : custom.optJSONArray("hidden"));
    List<Channel> out = new ArrayList<>();
    Set<String> ids = new HashSet<>();
    List<Category> categories = categories(custom);
    JSONArray own = custom == null ? null : custom.optJSONArray("channels");
    JSONArray list = tdt == null ? null : tdt.optJSONArray("channels");
    Set<String> tdtIds = new HashSet<>();
    if (list != null)
      for (int i = 0; i < list.length(); i++) {
        JSONObject o = list.optJSONObject(i);
        if (o != null) tdtIds.add(o.optString("id"));
      }
    if (own != null)
      for (int i = 0; i < own.length(); i++) {
        JSONObject o = own.optJSONObject(i);
        if (o == null || o.optBoolean("hidden")) continue;
        // A copy of a TDT channel kept for an event (syncTdtCopies in catalog.js): the TDT list, always current, wins.
        boolean copy = o.optBoolean("tdt");
        if (copy && tdtIds.contains(o.optString("id"))) continue;
        Channel c = new Channel(o, !copy, categories);
        if (!c.id.isEmpty() && c.playable() && ids.add(c.id)) out.add(c);
      }
    if (list != null)
      for (int i = 0; i < list.length(); i++) {
        JSONObject o = list.optJSONObject(i);
        if (o == null) continue;
        Channel c = new Channel(o, false, categories);
        if (c.id.isEmpty() || hidden.contains(c.id) || !ids.add(c.id)) continue;
        if (c.playable() || !c.web.isEmpty()) out.add(c);
      }
    return out;
  }

  /**
   * The copy of a logo on the public web (tools/logo_mirror.py): logos/ plus the first 24 hex digits of
   * the SHA-256 of its address. Null for images already on the public web.
   */
  public static String mirror(String url) {
    if (url == null || !url.startsWith("https://") || url.startsWith(SportsCatalog.WEB)) return null;
    try {
      byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(url.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder();
      for (int i = 0; i < 12; i++) hex.append(String.format(Locale.ROOT, "%02x", hash[i]));
      return SportsCatalog.WEB + "logos/" + hex + ".png";
    } catch (java.security.NoSuchAlgorithmException impossible) {
      return null;
    }
  }

  /** Link name of each channel, as merge() in web/catalog.js: in catalog order, repeated names get -2, -3… */
  public static Map<String, String> slugs(List<Channel> channels) {
    Map<String, String> out = new HashMap<>();
    Set<String> used = new HashSet<>();
    for (Channel c : channels) {
      String base = SportsCatalog.slugify(c.name), slug = base;
      for (int n = 2; used.contains(slug); n++) slug = base + "-" + n;
      used.add(slug);
      out.put(c.id, slug);
    }
    return out;
  }

  /** Featured channels in the administrator's order, falling back to the first playable ones. */
  public static List<Channel> featured(List<Channel> channels, JSONObject custom, int limit) {
    List<Channel> out = new ArrayList<>();
    JSONArray wanted = custom == null ? null : custom.optJSONArray("featured");
    if (wanted != null)
      for (int i = 0; i < wanted.length() && out.size() < limit; i++)
        for (Channel c : channels)
          if (c.id.equals(wanted.optString(i)) && c.playable() && !out.contains(c)) out.add(c);
    for (Channel c : channels) {
      if (out.size() >= limit) break;
      if (c.playable() && !out.contains(c)) out.add(c);
    }
    return out;
  }

  /** Resolve event references each time the catalog changes. */
  public static List<Channel> events(List<Channel> channels, JSONObject custom) {
    return events(channels, custom, System.currentTimeMillis(), false);
  }

  /**
   * Events and imported matches. Imported matches show only the Monday-to-Sunday week of their league's
   * next match (all of them with allWeeks, for links); without a channel they say «Canal por confirmar».
   */
  public static List<Channel> events(List<Channel> channels, JSONObject custom, long now, boolean allWeeks) {
    List<Channel> out = new ArrayList<>();
    if (custom == null) return out;
    List<JSONObject> all = new ArrayList<>(), imported = new ArrayList<>();
    for (JSONObject event : Competitions.all(custom)) {
      if (!event.optString("matchUrl").isEmpty() && MatchScores.expired(event.optString("matchId"), now)) continue;
      all.add(event);
      if (event.optBoolean("imported")) imported.add(event);
    }
    Set<String> week = Competitions.shownWeek(imported, now);
    for (JSONObject event : all) {
      if (event.optBoolean("imported") && !allWeeks && !week.contains(event.optString("id"))) continue;
      Channel target = null;
      for (Channel c : channels) if (c.id.equals(event.optString("channelId")) && c.playable()) { target = c; break; }
      List<String> sources = new ArrayList<>();
      if (target != null) sources.addAll(target.streams);
      JSONArray extra = event.optJSONArray("streams");
      if (extra != null) for (int i = 0; i < extra.length(); i++) {
        String link = extra.optString(i).trim();
        if ((link.startsWith("https://") || link.startsWith("http://")) && !sources.contains(link)) sources.add(link);
      }
      if (target == null && sources.isEmpty() && !event.optBoolean("imported")) continue;
      try {
        JSONObject league = SportsCatalog.find(custom.optJSONArray("leagues"), event.optString("leagueId"));
        JSONObject home = SportsCatalog.find(custom.optJSONArray("teams"), event.optString("homeTeamId"));
        JSONObject away = SportsCatalog.find(custom.optJSONArray("teams"), event.optString("awayTeamId"));
        String meta = SportsCatalog.meta(event, custom);
        JSONObject card = new JSONObject(event.toString()).put("id", event.getString("id")).put("name", event.getString("name"))
            .put("cover", event.optString("cover")).put("event", true)
            .put("background", league != null ? league.optString("background") : "").put("leagueLogo", league != null ? league.optString("logo") : "")
            .put("homeLogo", home != null ? home.optString("logo") : "").put("awayLogo", away != null ? away.optString("logo") : "");
        if (!sources.isEmpty()) card.put("channelId", target != null ? target.id : "").put("meta", meta).put("group", target != null ? target.name : "Fuentes del evento").put("streams", new JSONArray(sources));
        else card.put("channelId", "").put("pending", true).put("group", Competitions.PENDING).put("streams", new JSONArray())
            .put("meta", meta.isEmpty() ? Competitions.PENDING : meta + " · " + Competitions.PENDING);
        out.add(new Channel(card, true));
      } catch (JSONException ignored) {}
    }
    Collections.sort(out, (a,b) -> { int cmp=Long.compare(SportsCatalog.instant(a.startAt), SportsCatalog.instant(b.startAt));return cmp!=0?cmp:a.id.compareTo(b.id); });
    return out;
  }

  public static final String LIVE_ROW = "Eventos En Directo";

  /**
   * «Eventos En Directo», the first row of the home page as on the web: today's events (Madrid day) that have
   * something to play, in kick-off order; one that started before midnight stays while it may be on air.
   */
  public static List<Channel> liveEvents(List<Channel> events, long now) {
    java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
    f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
    String today = f.format(new Date(now));
    List<Channel> out = new ArrayList<>();
    for (Channel e : events) {
      if (!e.event || !e.playable()) continue;
      long at = SportsCatalog.instant(e.startAt);
      if (at == Long.MAX_VALUE) continue;
      if (f.format(new Date(at)).equals(today) || (at < now && now - at < 4 * 3600000L)) out.add(e);
    }
    Collections.sort(out, (a, b) -> Long.compare(SportsCatalog.instant(a.startAt), SportsCatalog.instant(b.startAt)));
    return out;
  }

  /**
   * The league rows of the home page show only this week's events (Monday to Sunday, Madrid), as on the web:
   * a league with matches in two weeks does not appear yet. Events without a league or a date stay, and a
   * match from last week still on air too.
   */
  public static List<Channel> thisWeekEvents(List<Channel> events, long now) {
    String week = Competitions.week(now);
    List<Channel> out = new ArrayList<>();
    for (Channel e : events) {
      long at = SportsCatalog.instant(e.startAt);
      if (e.leagueId.isEmpty() || at == Long.MAX_VALUE || Competitions.week(at).equals(week) || (at <= now && now - at < 4 * 3600000L)) out.add(e);
    }
    return out;
  }

  /** A home row: a league with its logo and its events in date order. */
  public static final class EventRow {
    /** The league's id ("" for «Otros eventos»), its name and logo. */
    public final String id, name, logo;
    public final List<Channel> events = new ArrayList<>();
    EventRow(String id, String name, String logo) { this.id = id; this.name = name; this.logo = logo; }
  }

  /** A league's page: its matches of every week that already have a channel or video (as leagueEvents on the web). */
  public static List<Channel> leagueEvents(List<Channel> channels, JSONObject custom, String leagueId, long now) {
    List<Channel> out = new ArrayList<>();
    for (Channel e : events(channels, custom, now, true)) if (e.leagueId.equals(leagueId) && e.playable() && !e.pending) out.add(e);
    return out;
  }

  /** One row per league, ordered by its next event; events without league go last. */
  public static List<EventRow> eventRows(List<Channel> events, JSONObject custom) {
    LinkedHashMap<String, EventRow> rows = new LinkedHashMap<>();
    EventRow other = new EventRow("", "Otros eventos", "");
    for (Channel e : events) {
      JSONObject league = SportsCatalog.find(custom == null ? null : custom.optJSONArray("leagues"), e.leagueId);
      if (league == null) { other.events.add(e); continue; }
      EventRow row = rows.get(e.leagueId);
      if (row == null) rows.put(e.leagueId, row = new EventRow(e.leagueId, league.optString("name"), league.optString("logo")));
      row.events.add(e);
    }
    // The order set in Administración → Ligas comes first (as on the web); the rest follow by their next event.
    final List<String> order = new ArrayList<>();
    JSONArray saved = custom == null ? null : custom.optJSONArray("leagueOrder");
    for (int i = 0; saved != null && i < saved.length(); i++) order.add(saved.optString(i));
    final List<String> ids = new ArrayList<>(rows.keySet());
    List<String> sorted = new ArrayList<>(ids);
    Collections.sort(sorted, (a, b) -> {
      int pa = order.indexOf(a), pb = order.indexOf(b);
      pa = pa < 0 ? order.size() : pa; pb = pb < 0 ? order.size() : pb;
      return pa != pb ? Integer.compare(pa, pb) : Integer.compare(ids.indexOf(a), ids.indexOf(b));
    });
    List<EventRow> out = new ArrayList<>();
    for (String id : sorted) out.add(rows.get(id));
    if (!other.events.isEmpty()) out.add(other);
    return out;
  }

  public static List<Channel> highlights(List<Channel> channels, JSONObject custom) {
    List<Channel> out=new ArrayList<>();
    for(Channel event: events(channels,custom))if(event.highlighted)out.add(event);
    Set<String> ids=strings(custom.optJSONArray("featured"));
    for(Channel c:channels)if(c.playable()&&ids.contains(c.id))out.add(c);
    return out.isEmpty()?featured(channels,custom,1):out;
  }

  /** Groups in display order; unknown groups go after the known ones, alphabetically. */
  public static LinkedHashMap<String, List<Channel>> groups(List<Channel> channels) {
    return groups(channels, null);
  }

  /** The administrator's category order comes first, then the default order, then the rest alphabetically. */
  public static LinkedHashMap<String, List<Channel>> groups(List<Channel> channels, JSONObject custom) {
    TreeMap<String, List<Channel>> extra = new TreeMap<>();
    LinkedHashMap<String, List<Channel>> out = new LinkedHashMap<>();
    for (Category k : categories(custom)) if (!out.containsKey(k.name)) out.put(k.name, new ArrayList<Channel>());
    for (String g : GROUP_ORDER) if (!out.containsKey(g)) out.put(g, new ArrayList<Channel>());
    for (Channel c : channels) {
      List<Channel> bucket = out.get(c.group);
      if (bucket == null) {
        bucket = extra.get(c.group);
        if (bucket == null) extra.put(c.group, bucket = new ArrayList<>());
      }
      bucket.add(c);
    }
    out.putAll(extra);
    Iterator<Map.Entry<String, List<Channel>>> it = out.entrySet().iterator();
    while (it.hasNext()) if (it.next().getValue().isEmpty()) it.remove();
    for (List<Channel> bucket : out.values()) {
      // Playable channels first; stable sort keeps the source order otherwise.
      Collections.sort(
          bucket,
          new Comparator<Channel>() {
            public int compare(Channel a, Channel b) {
              return Boolean.compare(b.playable(), a.playable());
            }
          });
    }
    return out;
  }

  private static Set<String> strings(JSONArray a) {
    Set<String> out = new HashSet<>();
    if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
    return out;
  }
}
