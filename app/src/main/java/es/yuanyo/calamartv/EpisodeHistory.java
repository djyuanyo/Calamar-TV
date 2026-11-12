package es.yuanyo.calamartv;

import android.content.Context;
import android.content.SharedPreferences;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Source;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/** The web's per-title, per-profile episode history, with a local copy for offline playback. */
final class EpisodeHistory {
  private final Context context;
  private final SharedPreferences prefs;
  private final String uid, profile, id, key;

  EpisodeHistory(Context context, String section, String title) {
    this.context = context.getApplicationContext();
    prefs = this.context.getSharedPreferences("episode-history", Context.MODE_PRIVATE);
    FirebaseUser user = Profiles.user(this.context);
    String active = Profiles.activeId();
    uid = user != null && active != null ? user.getUid() : null;
    profile = uid == null ? "" : active;
    id = documentId(profile, Library.page(section), title);
    key = (uid == null ? "guest" : uid) + ":" + id;
  }

  static String documentId(String profile, String page, String title) {
    String json = "[" + JSONObject.quote(profile) + "," + JSONObject.quote(page) + "," + JSONObject.quote(title) + "]";
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(json.replace("\\/", "/").getBytes(StandardCharsets.UTF_8));
      StringBuilder name = new StringBuilder("eh");
      for (int i = 0; i < 9; i++) {
        name.append(Character.forDigit((digest[i] >> 4) & 15, 16));
        name.append(Character.forDigit(digest[i] & 15, 16));
      }
      return name.toString();
    } catch (NoSuchAlgorithmException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  private static JSONObject decode(String json) {
    try { return json == null ? new JSONObject() : new JSONObject(json); }
    catch (JSONException invalid) { return new JSONObject(); }
  }

  static long watchedAt(JSONObject history, String episode) {
    JSONObject watched = history == null ? null : history.optJSONObject("watched");
    return watched == null ? 0 : watched.optLong(episode);
  }

  static JSONObject merge(JSONObject a, JSONObject b) {
    JSONObject recentA = a == null ? null : a.optJSONObject("recent");
    JSONObject recentB = b == null ? null : b.optJSONObject("recent");
    JSONObject recent = recentB != null && (recentA == null || recentB.optLong("at") > recentA.optLong("at")) ? recentB : recentA;
    JSONObject watched = new JSONObject();
    try {
      for (JSONObject value : new JSONObject[] {a, b}) {
        JSONObject source = value == null ? null : value.optJSONObject("watched");
        if (source == null) continue;
        for (Iterator<String> keys = source.keys(); keys.hasNext(); ) {
          String episode = keys.next();
          long time = source.optLong(episode);
          if (time > watched.optLong(episode)) watched.put(episode, time);
        }
      }
      return new JSONObject().put("recent", recent == null ? JSONObject.NULL : recent).put("watched", watched);
    } catch (JSONException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  JSONObject local() { return decode(prefs.getString(key, null)); }

  private JSONObject save(JSONObject incoming) {
    JSONObject joined = merge(local(), incoming);
    prefs.edit().putString(key, joined.toString()).apply();
    return joined;
  }

  void record(String episode, boolean completed, long now) {
    if (episode.isEmpty()) return;
    try {
      JSONObject watched = new JSONObject();
      if (completed) watched.put(episode, now);
      save(new JSONObject().put("recent", new JSONObject().put("episode", episode).put("at", now)).put("watched", watched));
      sync(null);
    } catch (JSONException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  void sync(Runnable refreshed) {
    if (uid == null) return;
    FirebaseUser user = Profiles.user(context);
    if (user == null || !uid.equals(user.getUid()) || !profile.equals(Profiles.activeId())) return;
    FirebaseFirestore db = FirebaseFirestore.getInstance(SharedCatalog.app(context));
    DocumentReference ref = db.document("calamarUsers/" + uid + "/progress/" + id);
    JSONObject local = local();
    if (local.optJSONObject("recent") == null) {
      ref.get(Source.SERVER).addOnSuccessListener(snapshot -> received(decode(snapshot.getString("json")), refreshed));
      return;
    }
    db.runTransaction(transaction -> {
      DocumentSnapshot snapshot = transaction.get(ref);
      JSONObject previous = decode(snapshot.getString("json"));
      JSONObject joined = merge(local, previous);
      if (!joined.toString().equals(previous.toString())) {
        Map<String, Object> fields = new HashMap<>();
        fields.put("json", joined.toString());
        fields.put("updatedAt", FieldValue.serverTimestamp());
        transaction.set(ref, fields);
      }
      return joined;
    }).addOnSuccessListener(joined -> received(joined, refreshed));
  }

  private void received(JSONObject history, Runnable refreshed) {
    String before = local().toString();
    JSONObject current = save(history);
    FirebaseUser user = Profiles.user(context);
    if (refreshed != null && user != null && uid.equals(user.getUid()) && profile.equals(Profiles.activeId())
        && !before.equals(current.toString())) refreshed.run();
  }
}
