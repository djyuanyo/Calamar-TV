package es.yuanyo.calamartv;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.ListenerRegistration;
import com.google.firebase.firestore.MetadataChanges;
import java.util.ArrayList;
import java.util.List;

/** One server-confirmed admission decision shared by all Android content screens. */
final class AppAccess {
  enum State { LOADING, ALLOWED, LOGIN, BLOCKED, ERROR }
  interface Listener { void changed(State state); }

  private static final Handler handler = new Handler(Looper.getMainLooper());
  private static final List<Listener> listeners = new ArrayList<>();
  private static State state = State.LOADING;
  private static ListenerRegistration policyListener, blockListener;
  private static FirebaseAuth auth;
  private static FirebaseAuth.AuthStateListener authListener;
  private static boolean policyReady, authReady, blockReady, required, blocked, administrator;
  private static boolean policyError, blockError;
  private static String uid;
  private static int generation, accountGeneration;
  private static State testState;

  private AppAccess() {}

  static Runnable observe(Context context, Listener listener) {
    if (auth == null && testState == null) retry(context);
    listeners.add(listener);
    listener.changed(state);
    return () -> listeners.remove(listener);
  }

  static State decide(boolean admin, boolean authReady, boolean policyReady, boolean failed,
                      boolean requireLogin, boolean signedIn, boolean blockReady, boolean blocked) {
    if (admin && authReady) return State.ALLOWED;
    if (failed) return State.ERROR;
    if (!authReady || !policyReady) return State.LOADING;
    if (!signedIn) return requireLogin ? State.LOGIN : State.ALLOWED;
    if (!blockReady) return State.LOADING;
    return blocked ? State.BLOCKED : State.ALLOWED;
  }

  private static void publish(State next) {
    if (state == next) return;
    state = next;
    for (Listener listener : new ArrayList<>(listeners)) listener.changed(next);
  }

  private static void refresh() {
    publish(decide(administrator, authReady, policyReady, policyError || blockError,
        required, uid != null, blockReady, blocked));
  }

  static void retry(Context context) {
    if (testState != null) return;
    int current = ++generation;
    if (policyListener != null) policyListener.remove();
    if (blockListener != null) blockListener.remove();
    if (auth != null && authListener != null) auth.removeAuthStateListener(authListener);
    policyReady = authReady = blockReady = policyError = blockError = administrator = false;
    uid = null;
    refresh();
    try {
      Context app = context.getApplicationContext();
      FirebaseFirestore db = FirebaseFirestore.getInstance(SharedCatalog.app(app));
      auth = SharedCatalog.auth(app);
      authListener = source -> {
        if (current != generation) return;
        FirebaseUser user = Profiles.verifiedUser(source.getCurrentUser());
        String next = user == null || user.isAnonymous() ? null : user.getUid();
        boolean admin = next != null && SharedCatalog.administrator(user);
        if (authReady && java.util.Objects.equals(uid, next) && administrator == admin) return;
        int account = ++accountGeneration;
        if (blockListener != null) blockListener.remove();
        uid = next;
        administrator = admin;
        authReady = true;
        blocked = blockError = false;
        blockReady = uid == null || administrator;
        if (!blockReady) {
          blockListener = db.collection("calamarUserAccess").document(uid).addSnapshotListener(
              MetadataChanges.INCLUDE, (snapshot, error) -> {
                if (current != generation || account != accountGeneration) return;
                if (error != null) blockError = true;
                else if (snapshot != null && !snapshot.getMetadata().isFromCache()
                    && !snapshot.getMetadata().hasPendingWrites()) {
                  blockReady = true;
                  blockError = false;
                  blocked = Boolean.TRUE.equals(snapshot.getBoolean("blocked"));
                }
                refresh();
              });
        }
        refresh();
        timeOut(current);
      };
      auth.addAuthStateListener(authListener);
      policyListener = db.document("calamarWeb/access").addSnapshotListener(
          MetadataChanges.INCLUDE, (snapshot, error) -> {
            if (current != generation) return;
            if (error != null) policyError = true;
            else if (snapshot != null && !snapshot.getMetadata().isFromCache()
                && !snapshot.getMetadata().hasPendingWrites()) {
              required = !Boolean.FALSE.equals(snapshot.getBoolean("requireLogin"));
              policyReady = true;
              policyError = false;
            }
            refresh();
          });
    } catch (RuntimeException unavailable) {
      policyError = true;
      refresh();
    }
    timeOut(current);
  }

  private static void timeOut(int current) {
    handler.postDelayed(() -> {
      if (generation == current && state == State.LOADING) publish(State.ERROR);
    }, 12000);
  }

  // Instrumentation supplies an isolated policy so decoder tests never depend on production.
  static void useTestState(State next) {
    if (!BuildConfig.DEBUG) throw new IllegalStateException("Instrumentation only");
    testState = next;
    publish(next);
  }
}
