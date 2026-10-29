package es.yuanyo.calamartv;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Source;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Accounts and profiles in the app, the same documents as the web: calamarUsers/<uid> (the profiles) and,
 * per profile, calamarUsers/<uid>/profiles/<id> («Mi lista», likes, favourite channels, what it played).
 * «Continuar viendo» of the main profile stays in calamarProgress/<uid>; the others in .../progress/<id>.
 */
final class Profiles {
  private Profiles() {}

  interface Listener { void changed(); }

  private static final Handler HANDLER = new Handler(Looper.getMainLooper());
  private static final List<Listener> LISTENERS = new ArrayList<>();
  private static JSONObject account;
  private static String uid, activeId;
  private static JSONObject data = ProfileData.empty();
  private static boolean started;
  private static Runnable pendingSave;
  /** «Elige tu perfil» was answered since the app opened (it is asked once each time). */
  static boolean pickedThisLaunch;

  private static FirebaseFirestore db(Context c) { return FirebaseFirestore.getInstance(SharedCatalog.app(c)); }
  private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("profiles", Context.MODE_PRIVATE); }
  private static void changed() { for (Listener l : new ArrayList<>(LISTENERS)) l.changed(); }

  static void listen(Listener listener) { if (!LISTENERS.contains(listener)) LISTENERS.add(listener); }
  static void forget(Listener listener) { LISTENERS.remove(listener); }

  static FirebaseUser user(Context c) {
    try { return SharedCatalog.auth(c).getCurrentUser(); } catch (RuntimeException unavailable) { return null; }
  }
  static boolean signedIn() { return uid != null; }
  static List<JSONObject> profiles() { return ProfileData.profiles(account); }
  static JSONObject active() {
    for (JSONObject p : profiles()) if (p.optString("id").equals(activeId)) return p;
    return null;
  }
  static String activeId() { return activeId; }
  static JSONObject data() { return data; }
  /** Signed in, with profiles, and none chosen since the app opened. */
  static boolean needsPick() { return uid != null && !profiles().isEmpty() && !pickedThisLaunch; }

  /** «Continuar viendo» of the profile watching (calamarProgress/<uid> for the main one or without profiles). */
  static DocumentReference progressDocument(Context c, FirebaseUser user) {
    return activeId == null || activeId.equals("main")
        ? db(c).document("calamarProgress/" + user.getUid())
        : db(c).document("calamarUsers/" + user.getUid() + "/progress/" + activeId);
  }

  /** Follows the sign-in once per process: the account's profiles, the one chosen last and its data. */
  /** True once the account's own copy of its profiles was read (until then, the copy kept on this device). */
  private static boolean confirmed;

  static void start(Context context) {
    if (started) return;
    started = true;
    final Context app = context.getApplicationContext();
    // A signed-in account: its profiles kept on this device, so «Elige tu perfil» shows at once.
    FirebaseUser now = user(app);
    if (now != null) {
      try {
        JSONObject cached = new JSONObject(prefs(app).getString("account:" + now.getUid(), "{}"));
        if (!ProfileData.profiles(cached).isEmpty()) {
          uid = now.getUid();
          account = cached;
          String saved = prefs(app).getString("active:" + uid, null);
          if (saved != null && active(saved) != null) choose(app, saved, false);
        }
      } catch (JSONException broken) { account = null; }
    }
    try {
      SharedCatalog.auth(app).addAuthStateListener(auth -> load(app, auth));
    } catch (RuntimeException unavailable) { /* Without Google Play services: no accounts on this device. */ }
  }

  private static void load(Context app, FirebaseAuth auth) {
    FirebaseUser user = auth.getCurrentUser();
    String now = user == null ? null : user.getUid();
    if (now == null) {
      confirmed = true;
      if (uid == null) return; // Still no account: nothing to tell (nor to draw again).
      prefs(app).edit().remove("account:" + uid).apply();
      uid = null; account = null; activeId = null; pickedThisLaunch = false;
      Library.Progress.scope = "";
      data = localData(app);
      changed();
      return;
    }
    if (now.equals(uid) && confirmed) return;
    if (!now.equals(uid)) {
      uid = now; account = null; activeId = null; pickedThisLaunch = false;
      Library.Progress.scope = "";
      data = localData(app);
    }
    confirmed = true;
    db(app).document("calamarUsers/" + uid).get(Source.SERVER).addOnCompleteListener(task -> {
      if (!now.equals(uid)) return;
      JSONObject found = null;
      if (task.isSuccessful() && task.getResult() != null && task.getResult().exists()) {
        try { found = new JSONObject(task.getResult().getString("json")); } catch (Exception broken) { found = null; }
      }
      if (found == null || ProfileData.profiles(found).isEmpty()) {
        String name = user.getDisplayName() != null && !user.getDisplayName().trim().isEmpty() ? user.getDisplayName().trim().split("\\s+")[0]
            : user.getEmail() != null ? user.getEmail().split("@")[0] : "Yo";
        try {
          found = new JSONObject().put("profiles", new JSONArray().put(ProfileData.newProfile(new ArrayList<>(), name, ProfileData.COLORS[0], new SecureRandom())));
          if (task.isSuccessful()) writeAccount(app, found);
        } catch (JSONException impossible) { return; }
      }
      account = found;
      prefs(app).edit().putString("account:" + uid, found.toString()).apply();
      if (activeId == null || active(activeId) == null) {
        String saved = prefs(app).getString("active:" + uid, null);
        if (saved != null && active(saved) != null) choose(app, saved, false);
        else if (profiles().size() == 1) choose(app, profiles().get(0).optString("id"), false);
      }
      changed();
    });
  }

  private static JSONObject active(String id) {
    for (JSONObject p : profiles()) if (p.optString("id").equals(id)) return p;
    return null;
  }

  private static String dataKey() { return uid != null && activeId != null ? "data:" + uid + ":" + activeId : "data:guest"; }
  private static JSONObject localData(Context app) {
    try { return ProfileData.valid(new JSONObject(prefs(app).getString(dataKey(), "{}"))); }
    catch (JSONException broken) { return ProfileData.empty(); }
  }

  /** The profile watching from now on: its «Continuar viendo», list, likes and favourites. */
  static void choose(Context context, String id, boolean picked) {
    final Context app = context.getApplicationContext();
    if (active(id) == null) return;
    if (picked) pickedThisLaunch = true;
    activeId = id;
    prefs(app).edit().putString("active:" + uid, id).apply();
    Library.Progress.scope = id.equals("main") ? "" : uid + ":" + id;
    data = localData(app);
    changed();
    final String asked = id, owner = uid;
    db(app).document("calamarUsers/" + uid + "/profiles/" + id).get(Source.SERVER).addOnCompleteListener(task -> {
      if (!asked.equals(activeId) || owner == null || !owner.equals(uid)) return;
      JSONObject cloud = null;
      if (task.isSuccessful() && task.getResult() != null && task.getResult().exists()) {
        try { cloud = ProfileData.valid(new JSONObject(task.getResult().getString("json"))); } catch (Exception broken) { cloud = null; }
      }
      JSONObject local = data;
      data = ProfileData.newer(local, cloud);
      prefs(app).edit().putString(dataKey(), data.toString()).apply();
      if (task.isSuccessful() && (cloud == null || local.optLong("updatedAt") > cloud.optLong("updatedAt"))) saveSoon(app, 0);
      changed();
    });
    ProgressSync.sync(app, shown -> { if (shown) changed(); });
  }

  private static void writeAccount(Context app, JSONObject value) {
    Map<String, Object> doc = new HashMap<>();
    doc.put("json", value.toString());
    doc.put("updatedAt", FieldValue.serverTimestamp());
    db(app).document("calamarUsers/" + uid).set(doc);
  }

  private static void saveSoon(Context app, long delay) {
    prefs(app).edit().putString(dataKey(), data.toString()).apply();
    if (uid == null || activeId == null) return;
    if (pendingSave != null) HANDLER.removeCallbacks(pendingSave);
    final String path = "calamarUsers/" + uid + "/profiles/" + activeId, json = data.toString();
    pendingSave = () -> {
      pendingSave = null;
      Map<String, Object> doc = new HashMap<>();
      doc.put("json", json);
      doc.put("updatedAt", FieldValue.serverTimestamp());
      db(app).document(path).set(doc);
    };
    HANDLER.postDelayed(pendingSave, delay);
  }

  private static void update(Context context, JSONObject next) {
    data = next;
    saveSoon(context.getApplicationContext(), 2000);
    changed();
  }

  static void toggleList(Context c, String page, String item) { update(c, ProfileData.toggleList(data, page, item, System.currentTimeMillis())); }
  static void rate(Context c, String page, String item, int value) { update(c, ProfileData.rate(data, page, item, value, System.currentTimeMillis())); }
  static void toggleFavorite(Context c, String channel) { update(c, ProfileData.toggleFavorite(data, channel, System.currentTimeMillis())); }
  static void markWatched(Context c, String page, String item) { update(c, ProfileData.markWatched(data, page, item, System.currentTimeMillis())); }

  // ---- Managing the profiles of the account ----
  static void add(Context c, String name, String color) {
    JSONObject profile = ProfileData.newProfile(profiles(), name, color, new SecureRandom());
    saveProfiles(c, withProfiles(profiles(), profile, null));
  }
  static void edit(Context c, String id, String name, String color) {
    List<JSONObject> others = new ArrayList<>();
    for (JSONObject p : profiles()) if (!p.optString("id").equals(id)) others.add(p);
    JSONObject edited = ProfileData.newProfile(others, name, color, new SecureRandom());
    try { edited.put("id", id); } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    saveProfiles(c, withProfiles(profiles(), null, edited));
  }
  static void remove(Context c, String id) {
    if (id.equals("main")) throw new IllegalArgumentException("El perfil principal no se puede borrar.");
    List<JSONObject> left = new ArrayList<>();
    for (JSONObject p : profiles()) if (!p.optString("id").equals(id)) left.add(p);
    saveProfiles(c, left);
    db(c).document("calamarUsers/" + uid + "/profiles/" + id).delete();
    db(c).document("calamarUsers/" + uid + "/progress/" + id).delete();
    if (id.equals(activeId)) choose(c, "main", true);
  }
  private static List<JSONObject> withProfiles(List<JSONObject> list, JSONObject added, JSONObject edited) {
    List<JSONObject> out = new ArrayList<>();
    for (JSONObject p : list) out.add(edited != null && p.optString("id").equals(edited.optString("id")) ? edited : p);
    if (added != null) out.add(added);
    return out;
  }
  private static void saveProfiles(Context c, List<JSONObject> list) {
    if (uid == null) throw new IllegalStateException("Inicia sesión para crear perfiles.");
    JSONArray array = new JSONArray();
    for (JSONObject p : list) array.put(p);
    try { account = new JSONObject(account == null ? "{}" : account.toString()).put("profiles", array); }
    catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    writeAccount(c.getApplicationContext(), account);
    prefs(c).edit().putString("account:" + uid, account.toString()).apply();
    changed();
  }
}
