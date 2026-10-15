package es.yuanyo.calamartv;

import android.content.Context;
import com.google.android.gms.tasks.Task;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.*;
import java.io.File;
import java.io.FileInputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.json.*;

/** Public catalog and Google identity; authorization is enforced by Firestore rules. */
final class SharedCatalog {
  static final String ADMIN_EMAIL = "juanjocarrillo7@gmail.com";
  static final String WEB_ADMIN = "https://djyuanyo.github.io/Calamar-TV/#/admin";
  static final String GOOGLE_CLIENT_ID = "1038892679964-qpuflpbtp3ju776ck36i9195oopst9c3.apps.googleusercontent.com";

  static synchronized FirebaseApp app(Context context) {
    try { return FirebaseApp.getInstance(); }
    catch (IllegalStateException missing) {
      return FirebaseApp.initializeApp(context.getApplicationContext(), new FirebaseOptions.Builder()
          .setApiKey("AIzaSyB5lJLnPd79iEupekufK5x11SXSqYL4dsk")
          .setApplicationId("1:1038892679964:android:e05efe5009b1a20f5db0d9")
          .setProjectId("menciamedia").setGcmSenderId("1038892679964")
          .setStorageBucket("menciamedia.firebasestorage.app").build());
    }
  }
  static FirebaseAuth auth(Context context) { return FirebaseAuth.getInstance(app(context)); }
  static DocumentReference document(Context context) {
    return FirebaseFirestore.getInstance(app(context)).document("calamarCatalog/custom");
  }
  static boolean administrator(FirebaseUser user) {
    if (user == null || !ADMIN_EMAIL.equals(user.getEmail()) || !user.isEmailVerified()) return false;
    for (com.google.firebase.auth.UserInfo provider : user.getProviderData())
      if ("google.com".equals(provider.getProviderId())) return true;
    return false;
  }
  static JSONObject validate(JSONObject data) throws JSONException {
    JSONArray channels = data.getJSONArray("channels");
    data.getJSONArray("featured"); data.getJSONArray("hidden");
    Set<String> ids = new HashSet<>();
    for (int i = 0; i < channels.length(); i++) {
      JSONObject channel = channels.getJSONObject(i);
      String id = channel.getString("id");
      if (id.isEmpty() || !ids.add(id) || channel.getString("name").trim().isEmpty()) throw new JSONException("Canal incompleto o duplicado");
      JSONArray streams = channel.getJSONArray("streams");
      if (streams.length() == 0) throw new JSONException("Añade al menos un enlace");
      for (int j = 0; j < streams.length(); j++) if (UserChannels.normalize(streams.getString(j)) == null) throw new JSONException("Enlace no válido");
    }
    if (data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 500000) throw new JSONException("El catálogo es demasiado grande");
    return data;
  }
  static JSONObject decode(DocumentSnapshot snapshot) throws JSONException {
    String json = snapshot.getString("json");
    if (json == null) throw new JSONException("Catálogo sin datos");
    return validate(new JSONObject(json));
  }
  static JSONObject cached(Context context) {
    try { return validate(new JSONObject(Io.read(new FileInputStream(new File(context.getFilesDir(), "shared-catalog.json"))))); }
    catch (Exception ignored) { return null; }
  }
  static void cache(Context context, JSONObject data) {
    try { Io.save(new File(context.getFilesDir(), "shared-catalog.json"), data.toString()); }
    catch (Exception ignored) { }
  }
  static Task<Long> publish(Context context, JSONObject data, long expected) {
    DocumentReference ref = document(context);
    final String json;
    try {
      if (!administrator(auth(context).getCurrentUser())) throw new IllegalStateException("Entra con la cuenta de administrador");
      json = validate(data).toString();
    } catch (Exception error) { return com.google.android.gms.tasks.Tasks.forException(error); }
    return ref.getFirestore().runTransaction(tx -> {
      DocumentSnapshot current = tx.get(ref);
      Long saved = current.exists() ? current.getLong("revision") : 0L;
      if (saved == null || saved != expected) throw new FirebaseFirestoreException(
          "El catálogo cambió en otro dispositivo. Recarga y vuelve a aplicar el cambio.", FirebaseFirestoreException.Code.ABORTED);
      Map<String, Object> value = new HashMap<>();
      value.put("json", json); value.put("revision", expected + 1); value.put("updatedAt", FieldValue.serverTimestamp());
      tx.set(ref, value);
      return expected + 1;
    });
  }
}
