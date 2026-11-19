package es.yuanyo.calamartv;

import android.app.Activity;
import android.graphics.Typeface;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.Timestamp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.DocumentSnapshot;
import com.google.firebase.firestore.FieldValue;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.firebase.firestore.Query;
import com.google.firebase.firestore.Source;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONObject;

/** Details for one account. Firebase requires administrator claims for these reads. */
public final class UserDetailsActivity extends Activity {
  private static final int PAGE = 30;
  private FirebaseFirestore db;
  private String uid;
  private LinearLayout body, history;
  private TextView message;
  private Button more;
  private DocumentSnapshot cursor;
  private String lastDay = "";
  private final FirebaseAuth.AuthStateListener auth = source -> {
    if (!SharedCatalog.administrator(source.getCurrentUser())) finish();
  };

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    uid = getIntent().getStringExtra("uid");
    if (uid == null || !uid.matches("[a-zA-Z0-9_-]{1,128}")
        || !SharedCatalog.administrator(SharedCatalog.auth(this).getCurrentUser())) {
      finish();
      return;
    }
    db = FirebaseFirestore.getInstance(SharedCatalog.app(this));
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(Ui.BG);
    scroll.setFitsSystemWindows(true);
    body = column();
    body.setPadding(dp(20), dp(12), dp(20), dp(28));
    scroll.addView(body);
    setContentView(scroll);
    Button back = button("‹ Volver a usuarios", this::finish);
    body.addView(back);
    back.requestFocus();
    message = text("Cargando cuenta…", 15);
    body.addView(message);
    load();
  }

  private void load() {
    Tasks.whenAllSuccess(db.document("calamarMembers/" + uid).get(Source.SERVER),
        db.document("calamarUsers/" + uid).get(Source.SERVER),
        db.document("calamarUserAccess/" + uid).get(Source.SERVER))
        .addOnSuccessListener(results -> {
          if (!alive()) return;
          DocumentSnapshot member = (DocumentSnapshot) results.get(0);
          DocumentSnapshot account = (DocumentSnapshot) results.get(1);
          DocumentSnapshot access = (DocumentSnapshot) results.get(2);
          if (!member.exists() && !account.exists() && !access.exists()) {
            message.setText("No se ha encontrado la cuenta.");
            return;
          }
          List<JSONObject> profiles = ProfileData.profiles(json(account.getString("json")));
          String fallback = profiles.isEmpty() ? "Usuario" : profiles.get(0).optString("name", "Usuario");
          body.removeView(message);
          showAccount(member, fallback, profiles.size(), Boolean.TRUE.equals(access.getBoolean("blocked")));
          showFavorites(profiles);
          LinearLayout panel = card("Historial de reproducción");
          message = text("Cargando reproducciones…", 14);
          panel.addView(message);
          history = column();
          panel.addView(history);
          more = button("Cargar más", this::loadHistory);
          more.setVisibility(android.view.View.GONE);
          panel.addView(more);
          loadHistory();
        }).addOnFailureListener(error -> message.setText("No se pudo cargar la cuenta."));
  }

  private void showAccount(DocumentSnapshot member, String fallback, int profiles, boolean blocked) {
    LinearLayout panel = card(or(member.getString("name"), fallback));
    panel.addView(text(or(member.getString("email"), "Correo pendiente"), 15));
    panel.addView(text("Registro · " + date(member.getTimestamp("registeredAt"), "dd/MM/yy HH:mm"), 14));
    panel.addView(text("Último acceso · " + date(member.getTimestamp("lastSeen"), "dd/MM/yy HH:mm"), 14));
    String provider = member.getString("provider");
    panel.addView(text("Método de acceso · " + ("google.com".equals(provider) ? "Google"
        : "password".equals(provider) ? "Correo y contraseña" : "Sin datos"), 14));
    panel.addView(text("Perfiles · " + profiles, 14));
    TextView status = text("", 14);
    panel.addView(status);
    boolean[] suspended = {blocked};
    boolean self = uid.equals(SharedCatalog.auth(this).getCurrentUser().getUid());
    Button access = button("", null);
    Runnable draw = () -> {
      status.setText(self ? "Administrador" : suspended[0] ? "Acceso bloqueado" : "Acceso activo");
      access.setText(self ? "Tu cuenta" : suspended[0] ? "Desbloquear acceso" : "Bloquear acceso");
      access.setEnabled(!self);
    };
    access.setOnClickListener(view -> {
      access.setEnabled(false);
      Map<String,Object> update = new HashMap<>();
      update.put("blocked", !suspended[0]);
      update.put("updatedAt", FieldValue.serverTimestamp());
      db.document("calamarUserAccess/" + uid).set(update).addOnSuccessListener(done -> {
        suspended[0] = !suspended[0];
        if (alive()) draw.run();
      }).addOnFailureListener(error -> {
        if (!alive()) return;
        status.setText("No se pudo cambiar el acceso.");
        access.setEnabled(true);
      });
    });
    panel.addView(access);
    draw.run();
  }

  private void showFavorites(List<JSONObject> profiles) {
    LinearLayout panel = card("Favoritos");
    if (profiles.isEmpty()) panel.addView(text("Esta cuenta todavía no tiene perfiles.", 14));
    for (JSONObject profile : profiles) {
      String id = profile.optString("id");
      if (!id.matches("[a-z0-9]{1,20}")) continue;
      panel.addView(heading(profile.optString("name", "Perfil"), 16));
      TextView items = text("Cargando favoritos…", 14);
      panel.addView(items);
      db.document("calamarUsers/" + uid + "/profiles/" + id).get(Source.SERVER)
          .addOnSuccessListener(snapshot -> {
            if (!alive()) return;
            JSONObject data = json(snapshot.getString("json"));
            new Thread(() -> resolveFavorites(data, items)).start();
          }).addOnFailureListener(error -> items.setText("No se pudieron cargar los favoritos."));
    }
  }

  private void resolveFavorites(JSONObject data, TextView view) {
    Map<String,String> names = new HashMap<>();
    try {
      JSONObject tdt = new JSONObject(Io.read(getAssets().open("tdt.json")));
      for (Catalog.Channel channel : Catalog.merge(tdt, SharedCatalog.cached(this))) names.put(channel.id, channel.name);
    } catch (Exception ignored) { }
    JSONObject saved = data.optJSONObject("list");
    if (saved != null && saved.length() > 0) {
      try {
        Library.Data library = Library.download();
        for (List<Library.Item> section : library.sections.values())
          for (Library.Item item : section) names.put(item.id, item.title);
      } catch (Exception ignored) { }
    }
    List<String> result = new ArrayList<>();
    JSONObject favorites = data.optJSONObject("favorites");
    if (favorites != null) favorites.keys().forEachRemaining(id -> result.add("Canal · " + names.getOrDefault(id, id)));
    if (saved != null) saved.keys().forEachRemaining(key -> {
      JSONObject item = saved.optJSONObject(key);
      if (item != null) {
        String id = item.optString("item");
        result.add("Mi lista · " + names.getOrDefault(id, id));
      }
    });
    runOnUiThread(() -> { if (alive()) view.setText(result.isEmpty() ? "Este perfil todavía no tiene favoritos." : String.join("\n", result)); });
  }

  private void loadHistory() {
    more.setEnabled(false);
    Query query = db.collection("calamarViewing").document(uid).collection("sessions")
        .orderBy("startedAt", Query.Direction.DESCENDING).limit(PAGE + 1);
    if (cursor != null) query = query.startAfter(cursor);
    query.get(Source.SERVER).addOnSuccessListener(snapshot -> {
      if (!alive()) return;
      List<DocumentSnapshot> entries = snapshot.getDocuments();
      int count = Math.min(PAGE, entries.size());
      for (int i = 0; i < count; i++) appendHistory(entries.get(i));
      if (count > 0) cursor = entries.get(count - 1);
      message.setText(cursor == null ? "Todavía no hay reproducciones registradas." : "Horas de España peninsular.");
      more.setVisibility(entries.size() > PAGE ? android.view.View.VISIBLE : android.view.View.GONE);
      more.setEnabled(true);
    }).addOnFailureListener(error -> {
      if (!alive()) return;
      message.setText("No se pudo cargar el historial.");
      more.setVisibility(android.view.View.VISIBLE);
      more.setEnabled(true);
    });
  }

  private void appendHistory(DocumentSnapshot entry) {
    Timestamp start = entry.getTimestamp("startedAt"), end = entry.getTimestamp("endedAt");
    String day = date(start, "EEEE d 'de' MMMM 'de' yyyy");
    if (!lastDay.equals(day)) {
      history.addView(heading(day, 16));
      lastDay = day;
    }
    String target = or(entry.getString("target"), "l:Contenido");
    history.addView(heading(or(entry.getString("title"), target.substring(2)), 15));
    String device = entry.getString("device");
    String platform = "web".equals(device) ? "Web" : "tv".equals(device) ? "Android TV" : "Android";
    String profile = or(entry.getString("profile"), "");
    history.addView(text(date(start, "HH:mm") + (end == null ? "" : " · Fin " + date(end, "HH:mm"))
        + " · " + platform + (profile.isEmpty() ? "" : " · " + profile), 14));
  }

  private static JSONObject json(String value) {
    try { return new JSONObject(value); } catch (Exception ignored) { return new JSONObject(); }
  }
  private static String or(String value, String fallback) { return value == null || value.isEmpty() ? fallback : value; }
  private static String date(Timestamp value, String pattern) {
    if (value == null) return "Sin datos";
    SimpleDateFormat format = new SimpleDateFormat(pattern, new Locale("es", "ES"));
    format.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
    return format.format(value.toDate());
  }
  private boolean alive() { return !isFinishing() && !isDestroyed(); }
  private int dp(int size) { return Ui.dp(this, size); }
  private LinearLayout column() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view; }
  private TextView text(String value, int size) {
    TextView view = new TextView(this);
    view.setText(value); view.setTextSize(size); view.setTextColor(Ui.FG);
    view.setPadding(0, dp(5), 0, dp(5));
    return view;
  }
  private TextView heading(String value, int size) {
    TextView view = text(value, size);
    view.setTypeface(null, Typeface.BOLD);
    return view;
  }
  private LinearLayout card(String title) {
    LinearLayout card = column();
    card.setBackground(Ui.shape(this, Ui.SURFACE, 14, 1, 0x2affffff));
    card.setPadding(dp(16), dp(12), dp(16), dp(12));
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
    params.topMargin = dp(12);
    body.addView(card, params);
    card.addView(heading(title, 21));
    return card;
  }
  private Button button(String value, Runnable action) {
    Button button = Ui.pill(this, value, Ui.Kind.SURFACE, true);
    if (action != null) button.setOnClickListener(view -> action.run());
    return button;
  }
  @Override protected void onStart() { super.onStart(); SharedCatalog.auth(this).addAuthStateListener(auth); }
  @Override protected void onStop() { SharedCatalog.auth(this).removeAuthStateListener(auth); super.onStop(); }
}
