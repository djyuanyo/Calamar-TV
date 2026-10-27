package es.yuanyo.calamartv;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Source;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * «Continuar viendo» on every device of the signed-in account: this device's row (Library.Progress)
 * joined with the copy in Firestore (calamarProgress/<uid>, also written by the web) when the home page
 * comes back and a few seconds after each change. Without an account nothing leaves the device.
 */
final class ProgressSync {
  private ProgressSync() {}

  interface Done {
    void changed(boolean shownRowChanged);
  }

  private static final Handler HANDLER = new Handler(Looper.getMainLooper());
  private static final long PUSH_AFTER_MS = 3000;
  private static Runnable pending;
  private static boolean busy;

  private static DocumentReference document(Context context, FirebaseUser user) {
    return FirebaseFirestore.getInstance(SharedCatalog.app(context)).document("calamarProgress/" + user.getUid());
  }

  static void pushSoon(Context context) {
    final Context app = context.getApplicationContext();
    if (SharedCatalog.auth(app).getCurrentUser() == null) return;
    if (pending != null) HANDLER.removeCallbacks(pending);
    pending = () -> { pending = null; sync(app, null); };
    HANDLER.postDelayed(pending, PUSH_AFTER_MS);
  }

  /** Joins both copies and keeps the result in both; tells whether this device's row changed. */
  static void sync(Context context, Done done) {
    final Context app = context.getApplicationContext();
    FirebaseUser user = SharedCatalog.auth(app).getCurrentUser();
    if (user == null || busy) {
      if (done != null) done.changed(false);
      return;
    }
    busy = true;
    DocumentReference doc = document(app, user);
    doc.get(Source.SERVER).addOnCompleteListener(task -> {
      boolean changed = false;
      try {
        JSONObject cloud = new JSONObject();
        if (task.isSuccessful() && task.getResult() != null && task.getResult().exists()) {
          String json = task.getResult().getString("json");
          if (json != null) cloud = new JSONObject(json);
        } else if (!task.isSuccessful()) return;
        JSONObject local = Library.Progress.load(app);
        JSONObject merged = Library.Progress.merge(Library.Progress.toCloud(local, Library.Progress.loadRemoved(app)), cloud, System.currentTimeMillis());
        JSONObject store = Library.Progress.fromCloud(merged, local);
        changed = !shown(store).equals(shown(local));
        Library.Progress.write(app, store, merged.optJSONObject("removed"));
        if (!merged.toString().equals(cloud.toString())) {
          Map<String, Object> value = new HashMap<>();
          value.put("json", merged.toString());
          value.put("updatedAt", FieldValue.serverTimestamp());
          doc.set(value);
        }
      } catch (JSONException broken) {
        changed = false;
      } finally {
        busy = false;
        if (done != null) done.changed(changed);
      }
    });
  }

  /** What the row shows: each title with its time and position. */
  private static String shown(JSONObject store) {
    StringBuilder out = new StringBuilder();
    java.util.List<JSONObject> list = Library.Progress.list(store);
    for (JSONObject e : list) out.append(e.optString("key")).append(':').append(e.optLong("at")).append(':').append(e.optLong("position")).append(';');
    return out.toString();
  }
}
