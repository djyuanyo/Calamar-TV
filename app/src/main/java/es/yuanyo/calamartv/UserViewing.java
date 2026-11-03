package es.yuanyo.calamartv;

import android.content.Context;
import android.content.res.Configuration;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.DocumentReference;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.WriteBatch;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.json.JSONObject;

/** A private playback entry and its short-lived live presence. */
final class UserViewing {
  private final Context context;
  private final FirebaseFirestore db;
  private final String id = UUID.randomUUID().toString().replace("-", "");
  private final Map<String, Object> details = new HashMap<>();
  private final DocumentReference live;
  private DocumentReference history;
  private String uid;
  private boolean started, playing, closed;
  private Task<Void> queue = Tasks.forResult(null);

  UserViewing(Context context, FirebaseFirestore db, String target, String title) {
    this.context = context.getApplicationContext();
    this.db = db;
    live = db.collection("calamarLiveViewers").document(id);
    details.put("target", target);
    details.put("title", shorten(title, 250));
    JSONObject profile = Profiles.active();
    details.put("profile", profile == null ? "" : shorten(profile.optString("name"), 24));
    boolean television = context.getPackageManager().hasSystemFeature("android.software.leanback")
        || (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_TYPE_MASK)
            == Configuration.UI_MODE_TYPE_TELEVISION;
    details.put("device", television ? "tv" : "android");
  }

  private static String shorten(String value, int size) {
    return value == null ? "" : value.substring(0, Math.min(size, value.length()));
  }

  void watching(boolean value) {
    if (closed || playing == value) return;
    playing = value;
    if (value) beat();
    else queue = queue.continueWithTask(ignored -> started && ownsSession() ? live.delete() : Tasks.forResult(null));
  }

  private boolean ownsSession() {
    FirebaseUser user = Profiles.user(context);
    return user != null && !user.isAnonymous() && user.getUid().equals(uid);
  }

  void beat() {
    queue = queue.continueWithTask(ignored -> {
      if (!playing || closed) return Tasks.forResult(null);
      FirebaseUser user = Profiles.user(context);
      if (user == null || user.isAnonymous()) return Tasks.forResult(null);
      if (uid == null) {
        uid = user.getUid();
        history = db.collection("calamarViewing").document(uid).collection("sessions").document(id);
      }
      if (!ownsSession()) return Tasks.forResult(null);
      Map<String, Object> active = new HashMap<>(details);
      active.put("uid", uid);
      active.put("updatedAt", FieldValue.serverTimestamp());
      if (started) return live.set(active);
      Map<String, Object> entry = new HashMap<>(details);
      entry.put("startedAt", FieldValue.serverTimestamp());
      WriteBatch batch = db.batch().set(history, entry).set(live, active);
      return batch.commit().continueWith(task -> {
        if (task.isSuccessful()) started = true;
        return null;
      });
    });
  }

  void close() {
    if (closed) return;
    closed = true;
    queue = queue.continueWithTask(ignored -> {
      if (!started || !ownsSession()) return Tasks.forResult(null);
      live.delete();
      return history.update("endedAt", FieldValue.serverTimestamp());
    });
  }
}
