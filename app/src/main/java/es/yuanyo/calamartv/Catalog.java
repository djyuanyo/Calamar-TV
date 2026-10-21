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

  public static final class Channel {
    public final String id, name, group, region, logo, web, cover, channelId, meta, startAt, status;
    public final boolean highlighted;
    public final boolean event;
    public final List<String> streams;
    public final boolean geo, own;

    Channel(JSONObject o, boolean own) {
      this.own = own;
      event = o.optBoolean("event");
      cover = o.optString("cover");
      channelId = o.optString("channelId", o.optString("id"));
      meta = o.optString("meta"); startAt = o.optString("startAt"); status = o.optString("status", "scheduled");
      highlighted = o.optBoolean("featured");
      id = o.optString("id");
      name = o.optString("name", "Canal");
      String g = o.optString("group").trim();
      group = g.isEmpty() ? (own ? OWN_GROUP : "Otros") : g;
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

  private static String https(String url) {
    return url != null && url.startsWith("https://") ? url : "";
  }

  /** Administrator channels first, then TDT channels not hidden by the administrator. */
  public static List<Channel> merge(JSONObject tdt, JSONObject custom) {
    Set<String> hidden = strings(custom == null ? null : custom.optJSONArray("hidden"));
    List<Channel> out = new ArrayList<>();
    Set<String> ids = new HashSet<>();
    JSONArray own = custom == null ? null : custom.optJSONArray("channels");
    if (own != null)
      for (int i = 0; i < own.length(); i++) {
        JSONObject o = own.optJSONObject(i);
        if (o == null || o.optBoolean("hidden")) continue;
        Channel c = new Channel(o, true);
        if (!c.id.isEmpty() && c.playable() && ids.add(c.id)) out.add(c);
      }
    JSONArray list = tdt == null ? null : tdt.optJSONArray("channels");
    if (list != null)
      for (int i = 0; i < list.length(); i++) {
        JSONObject o = list.optJSONObject(i);
        if (o == null) continue;
        Channel c = new Channel(o, false);
        if (c.id.isEmpty() || hidden.contains(c.id) || !ids.add(c.id)) continue;
        if (c.playable() || !c.web.isEmpty()) out.add(c);
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
    List<Channel> out = new ArrayList<>();
    JSONArray events = custom == null ? null : custom.optJSONArray("events");
    if (events == null) return out;
    for (int i = 0; i < events.length(); i++) {
      JSONObject event = events.optJSONObject(i);
      if (event == null) continue;
      for (Channel target : channels) if (target.id.equals(event.optString("channelId")) && target.playable()) {
        try {
          JSONObject card = new JSONObject(event.toString()).put("id", event.getString("id")).put("channelId", target.id).put("meta", SportsCatalog.meta(event, custom)).put("name", event.getString("name"))
              .put("group", target.name).put("cover", event.getString("cover")).put("event", true)
              .put("streams", new JSONArray(target.streams));
          out.add(new Channel(card, true));
        } catch (JSONException ignored) {}
        break;
      }
    }
    Collections.sort(out, (a,b) -> { int cmp=Long.compare(SportsCatalog.instant(a.startAt), SportsCatalog.instant(b.startAt));return cmp!=0?cmp:a.id.compareTo(b.id); });
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
    TreeMap<String, List<Channel>> extra = new TreeMap<>();
    LinkedHashMap<String, List<Channel>> out = new LinkedHashMap<>();
    for (String g : GROUP_ORDER) out.put(g, new ArrayList<Channel>());
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
