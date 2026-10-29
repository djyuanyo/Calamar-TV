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
  static final String GOOGLE_CLIENT_ID =
      "1038892679964-qpuflpbtp3ju776ck36i9195oopst9c3.apps.googleusercontent.com";

  static synchronized FirebaseApp app(Context context) {
    try {
      return FirebaseApp.getInstance();
    } catch (IllegalStateException missing) {
      return FirebaseApp.initializeApp(
          context.getApplicationContext(),
          new FirebaseOptions.Builder()
              .setApiKey("AIzaSyB5lJLnPd79iEupekufK5x11SXSqYL4dsk")
              .setApplicationId("1:1038892679964:android:e05efe5009b1a20f5db0d9")
              .setProjectId("menciamedia")
              .setGcmSenderId("1038892679964")
              .setStorageBucket("menciamedia.firebasestorage.app")
              .build());
    }
  }

  static FirebaseAuth auth(Context context) {
    return FirebaseAuth.getInstance(app(context));
  }

  static DocumentReference document(Context context) {
    return FirebaseFirestore.getInstance(app(context)).document("calamarCatalog/custom");
  }

  static boolean administrator(FirebaseUser user) {
    if (user == null || !ADMIN_EMAIL.equals(user.getEmail()) || !user.isEmailVerified())
      return false;
    for (com.google.firebase.auth.UserInfo provider : user.getProviderData())
      if ("google.com".equals(provider.getProviderId())) return true;
    return false;
  }

  static JSONObject validate(JSONObject data) throws JSONException {
    JSONArray channels = data.getJSONArray("channels");
    data.getJSONArray("featured");
    data.getJSONArray("hidden");
    Set<String> ids = new HashSet<>();
    for (int i = 0; i < channels.length(); i++) {
      JSONObject channel = channels.getJSONObject(i);
      String id = channel.getString("id");
      if (id.isEmpty() || !ids.add(id) || channel.getString("name").trim().isEmpty())
        throw new JSONException("Canal incompleto o duplicado");
      JSONArray streams = channel.getJSONArray("streams");
      if (streams.length() == 0) throw new JSONException("Añade al menos un enlace");
      for (int j = 0; j < streams.length(); j++)
        if (UserChannels.normalize(streams.getString(j)) == null)
          throw new JSONException("Enlace no válido");
    }
    for (String list : new String[]{"events", "fixtures"}) {
      JSONArray entries = data.optJSONArray(list);
      if (entries == null) continue;
      for (int i = 0; i < entries.length(); i++) {
        JSONObject entry = entries.getJSONObject(i);
        if (!entry.has("streams")) continue;
        JSONArray links = entry.getJSONArray("streams");
        if (links.length() > 50) throw new JSONException("Máximo 50 fuentes por evento");
        for (int j = 0; j < links.length(); j++) {
          try {
            java.net.URI uri = new java.net.URI(links.getString(j));
            if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null)
              throw new Exception("URL inválida");
          } catch (Exception invalid) { throw new JSONException("Fuente de evento no válida"); }
        }
      }
    }
    Set<String> eventIds = new HashSet<>();
    if (data.has("events")) {
      JSONArray events = data.getJSONArray("events");
      for (int i = 0; i < events.length(); i++) {
        JSONObject event = events.getJSONObject(i);
        String id = event.getString("id"), cover = event.getString("cover");
        if (id.isEmpty() || !eventIds.add(id) || event.getString("name").trim().isEmpty()
            || (!ids.contains(event.optString("channelId")) && (event.optJSONArray("streams") == null || event.getJSONArray("streams").length() == 0)) || !validCover(cover))
          throw new JSONException("Cada evento necesita nombre, portada y un canal creado");
      }
    }
    SportsCatalog.validate(data);
    Competitions.validate(data, ids, eventIds);
    JSONArray order = data.optJSONArray("groupOrder");
    if (data.has("groupOrder") && (order == null || order.length() > 200))
      throw new JSONException("Orden de categorías no válido");
    Set<String> categories = new HashSet<>();
    if (order != null)
      for (int i = 0; i < order.length(); i++) {
        Object g = order.get(i);
        if (!(g instanceof String) || ((String) g).trim().isEmpty() || ((String) g).length() > 80 || !categories.add((String) g))
          throw new JSONException("Orden de categorías no válido");
      }
    JSONArray list = data.optJSONArray("categories");
    if (data.has("categories") && (list == null || list.length() > 200))
      throw new JSONException("Categorías no válidas");
    Set<String> categoryIds = new HashSet<>(), categoryNames = new HashSet<>();
    if (list != null)
      for (int i = 0; i < list.length(); i++) {
        JSONObject c = list.getJSONObject(i);
        String id = c.optString("id"), name = c.optString("name").trim();
        if (id.trim().isEmpty() || id.length() > 80 || name.isEmpty() || c.optString("name").length() > 80
            || !c.optString("color").matches("#[0-9a-fA-F]{6}")
            || !categoryIds.add(id) || !categoryNames.add(name.toLowerCase(java.util.Locale.ROOT)))
          throw new JSONException("Categoría incompleta o repetida");
      }
    if (data.has("libraryVisible") && !(data.opt("libraryVisible") instanceof Boolean))
      throw new JSONException("El interruptor de películas y series no es válido");
    if (data.has("appUpdates") && !"all".equals(data.opt("appUpdates")) && !"admin".equals(data.opt("appUpdates")))
      throw new JSONException("El aviso de actualizaciones de la app no es válido");
    if (data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 500000)
      throw new JSONException("El catálogo es demasiado grande");
    return data;
  }

  static boolean validCover(String cover) {
    if (cover.startsWith("data:image/")) return cover.length() <= 180000
        && cover.matches("^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$");
    try {
      java.net.URI uri = new java.net.URI(cover);
      return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null;
    } catch (Exception invalid) { return false; }
  }

  static JSONObject decode(DocumentSnapshot snapshot) throws JSONException {
    String json = snapshot.getString("json");
    if (json == null) throw new JSONException("Catálogo sin datos");
    return validate(new JSONObject(json));
  }

  static JSONObject cached(Context context) {
    try {
      return validate(
          new JSONObject(
              Io.read(
                  new FileInputStream(new File(context.getFilesDir(), "shared-catalog.json")))));
    } catch (Exception ignored) {
      return null;
    }
  }

  static void cache(Context context, JSONObject data) {
    try {
      Io.save(new File(context.getFilesDir(), "shared-catalog.json"), data.toString());
    } catch (Exception ignored) {
    }
  }

  static Task<Long> publish(Context context, JSONObject data, long expected) {
    DocumentReference ref = document(context);
    final String json;
    try {
      if (!administrator(auth(context).getCurrentUser()))
        throw new IllegalStateException("Entra con la cuenta de administrador");
      json = validate(data).toString();
    } catch (Exception error) {
      return com.google.android.gms.tasks.Tasks.forException(error);
    }
    return ref.getFirestore()
        .runTransaction(
            tx -> {
              DocumentSnapshot current = tx.get(ref);
              Long saved = current.exists() ? current.getLong("revision") : 0L;
              if (saved == null || saved != expected)
                throw new FirebaseFirestoreException(
                    "El catálogo cambió en otro dispositivo. Recarga y vuelve a aplicar el cambio.",
                    FirebaseFirestoreException.Code.ABORTED);
              Map<String, Object> value = new HashMap<>();
              value.put("json", json);
              value.put("revision", expected + 1);
              value.put("updatedAt", FieldValue.serverTimestamp());
              tx.set(ref, value);
              return expected + 1;
            });
  }
}
