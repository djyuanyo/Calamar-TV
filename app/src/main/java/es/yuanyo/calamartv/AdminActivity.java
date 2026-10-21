package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.widget.*;
import androidx.credentials.*;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.GoogleAuthProvider;
import com.google.firebase.firestore.Source;
import java.io.File;
import java.util.UUID;
import org.json.*;

/** Shared catalog administration. Google credentials never pass through a WebView. */
public class AdminActivity extends Activity {
  private static final int BG = 0xff0b0d10, FG = 0xfff5f5f5, ACC = 0xffd6ff00;
  private LinearLayout body;
  private TextView status;
  private JSONObject catalog;
  private long revision;
  private boolean loading, saving;
  private EditText pendingCover;
  private FirebaseAuth.AuthStateListener authListener;

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setStatusBarColor(BG);
    getWindow().setNavigationBarColor(BG);
    draw();
    authListener =
        auth -> {
          catalog = null;
          if (SharedCatalog.administrator(auth.getCurrentUser())) load();
          else draw();
        };
    SharedCatalog.auth(this).addAuthStateListener(authListener);
  }

  @Override
  protected void onDestroy() {
    if (authListener != null) SharedCatalog.auth(this).removeAuthStateListener(authListener);
    super.onDestroy();
  }

  private void draw() {
    if (isFinishing()) return;
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(BG);
    body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    body.setPadding(dp(20), dp(16), dp(20), dp(32));
    body.setFitsSystemWindows(true);
    scroll.addView(body);
    setContentView(scroll);
    addButton("‹ Volver", this::finish);
    TextView title = label("ADMINISTRACIÓN", 25);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    body.addView(title);
    status = label("", 15);
    status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
    body.addView(status);
    if (!SharedCatalog.administrator(SharedCatalog.auth(this).getCurrentUser())) {
      body.addView(
          label(
              "Entra con "
                  + SharedCatalog.ADMIN_EMAIL
                  + " para publicar canales y eventos en la web y la app.",
              17));
      addButton("Continuar con Google", this::signIn);
      if (SharedCatalog.auth(this).getCurrentUser() != null) {
        status.setText("La cuenta seleccionada no es administradora.");
        addButton("Cerrar sesión", () -> SharedCatalog.auth(this).signOut());
      }
      body.addView(
          label(
              "En televisores sin acceso de Google puedes administrar desde la web. Los canales"
                  + " publicados aparecerán aquí automáticamente.",
              15));
      addButton("Administrar en el navegador", this::openWeb);
      return;
    }
    body.addView(
        label(
            "Publica canales y eventos para la web, Android y Android TV.",
            16));
    addButton("Cerrar sesión de Google", () -> SharedCatalog.auth(this).signOut());
    addButton("Recargar catálogo", this::load);
    if (loading) {
      status.setText("Cargando catálogo…");
      return;
    }
    if (catalog == null) {
      status.setText("Pulsa Recargar catálogo para conectar.");
      return;
    }
    addButton("Crear canal", () -> edit(null));
    addButton("Crear evento", () -> editEvent(null));
    JSONArray events = catalog.optJSONArray("events");
    if (events != null) {
      body.addView(label("EVENTOS PUBLICADOS · " + events.length(), 18));
      for (int i = 0; i < events.length(); i++) {
        JSONObject event = events.optJSONObject(i);
        if (event == null) continue;
        addButton("Editar evento: " + event.optString("name"), () -> editEvent(event));
        addButton("Eliminar evento: " + event.optString("name"), () -> new AlertDialog.Builder(this)
            .setTitle("¿Eliminar el evento?").setMessage(event.optString("name"))
            .setNegativeButton("Cancelar", null).setPositiveButton("Eliminar", (d, w) -> {
              try { JSONObject next = copy(); next.put("events", withoutChannel(next.getJSONArray("events"), event.getString("id"))); publish(next); }
              catch (Exception error) { fail(error); }
            }).show());
      }
    }
    JSONArray channels = catalog.optJSONArray("channels");
    body.addView(label("CANALES PUBLICADOS · " + channels.length(), 18));
    for (int i = 0; i < channels.length(); i++) {
      JSONObject channel = channels.optJSONObject(i);
      if (channel == null) continue;
      String id = channel.optString("id");
      body.addView(
          label(
              (contains(catalog.optJSONArray("featured"), id) ? "★ " : "")
                  + channel.optString("name")
                  + " · "
                  + channel.optString("group", "Calamar TV"),
              18));
      addButton("Editar " + channel.optString("name"), () -> edit(channel));
      addButton(
          "Eliminar " + channel.optString("name"),
          () ->
              new AlertDialog.Builder(this)
                  .setTitle("¿Retirar del catálogo público?")
                  .setMessage(channel.optString("name") + " y sus eventos asociados")
                  .setNegativeButton("Cancelar", null)
                  .setPositiveButton(
                      "Eliminar",
                      (d, w) -> {
                        try {
                          JSONObject next = copy();
                          JSONArray remaining = new JSONArray();
                          JSONArray linked = next.optJSONArray("events");
                          if (linked != null) for (int e = 0; e < linked.length(); e++)
                            if (!id.equals(linked.getJSONObject(e).getString("channelId"))) remaining.put(linked.get(e));
                          next.put("events", remaining);
                          next.put("channels", withoutChannel(next.getJSONArray("channels"), id));
                          next.put("featured", withoutId(next.getJSONArray("featured"), id));
                          next.put("hidden", withoutId(next.getJSONArray("hidden"), id));
                          publish(next);
                        } catch (Exception error) {
                          fail(error);
                        }
                      })
                  .show());
    }
  }

  private void signIn() {
    status.setText("Abriendo Google…");
    try {
      GetSignInWithGoogleOption option =
          new GetSignInWithGoogleOption.Builder(SharedCatalog.GOOGLE_CLIENT_ID).build();
      GetCredentialRequest request =
          new GetCredentialRequest.Builder().addCredentialOption(option).build();
      CredentialManager.create(this)
          .getCredentialAsync(
              this,
              request,
              null,
              command -> runOnUiThread(command),
              new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                  try {
                    Credential credential = response.getCredential();
                    if (!(credential instanceof CustomCredential)
                        || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(
                            credential.getType()))
                      throw new IllegalStateException("Google no devolvió una cuenta compatible.");
                    GoogleIdTokenCredential google =
                        GoogleIdTokenCredential.createFrom(credential.getData());
                    SharedCatalog.auth(AdminActivity.this)
                        .signInWithCredential(
                            GoogleAuthProvider.getCredential(google.getIdToken(), null))
                        .addOnFailureListener(AdminActivity.this::fail);
                  } catch (Exception error) {
                    fail(error);
                  }
                }

                @Override
                public void onError(GetCredentialException error) {
                  status.setText(
                      "No se completó el acceso con Google. Puedes volver a intentarlo o"
                          + " administrar desde el navegador.");
                }
              });
    } catch (Exception error) {
      fail(error);
    }
  }

  private void load() {
    if (loading
        || saving
        || !SharedCatalog.administrator(SharedCatalog.auth(this).getCurrentUser())) return;
    loading = true;
    draw();
    SharedCatalog.document(this)
        .get(Source.SERVER)
        .addOnSuccessListener(
            snapshot -> {
              if (isFinishing()) return;
              loading = false;
              try {
                if (snapshot.exists()) {
                  catalog = SharedCatalog.decode(snapshot);
                  Long rev = snapshot.getLong("revision");
                  if (rev == null || rev < 1)
                    throw new JSONException("Revisión del catálogo no válida");
                  revision = rev;
                } else {
                  catalog =
                      SharedCatalog.validate(
                          new JSONObject(Io.read(getAssets().open("custom.json"))));
                  revision = 0;
                }
                draw();
                status.setText("Conectado · Revisión " + revision);
              } catch (Exception error) {
                catalog = null;
                draw();
                fail(error);
              }
            })
        .addOnFailureListener(
            error -> {
              loading = false;
              draw();
              fail(error);
            });
  }

  private void publish(JSONObject next) {
    if (saving || loading) return;
    saving = true;
    status.setText("Publicando…");
    SharedCatalog.publish(this, next, revision)
        .addOnSuccessListener(
            saved -> {
              saving = false;
              catalog = next;
              revision = saved;
              SharedCatalog.cache(this, next);
              draw();
              status.setText("Publicado. La web y la app reciben los cambios automáticamente.");
            })
        .addOnFailureListener(
            error -> {
              saving = false;
              // Keep the last confirmed catalog. A stale revision always requires a fresh read.
              fail(error);
            });
  }

  private void edit(JSONObject existing) {
    if (catalog == null || saving) return;
    LinearLayout form = new LinearLayout(this);
    form.setOrientation(LinearLayout.VERTICAL);
    form.setPadding(dp(20), dp(8), dp(20), dp(8));
    EditText name = input(form, "Nombre", existing == null ? "" : existing.optString("name"));
    EditText group =
        input(
            form,
            "Categoría",
            existing == null ? "Calamar TV" : existing.optString("group", "Calamar TV"));
    EditText logo =
        input(form, "Logo https (opcional)", existing == null ? "" : existing.optString("logo"));
    EditText streams =
        input(
            form,
            "Enlaces (uno por línea)",
            existing == null ? "" : join(existing.optJSONArray("streams")));
    streams.setSingleLine(false);
    streams.setMinLines(3);
    streams.setInputType(
        InputType.TYPE_CLASS_TEXT
            | InputType.TYPE_TEXT_FLAG_MULTI_LINE
            | InputType.TYPE_TEXT_VARIATION_URI);
    CheckBox featured = new CheckBox(this);
    featured.setText("Destacar en la portada");
    featured.setChecked(
        existing != null && contains(catalog.optJSONArray("featured"), existing.optString("id")));
    form.addView(featured);
    TextView error = new TextView(this);
    error.setTextColor(Color.RED);
    form.addView(error);
    ScrollView scroll = new ScrollView(this);
    scroll.addView(form);
    AlertDialog dialog =
        new AlertDialog.Builder(this)
            .setTitle(existing == null ? "Crear canal" : "Editar canal")
            .setView(scroll)
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Guardar y publicar", null)
            .create();
    dialog.setOnShowListener(
        ignored ->
            dialog
                .getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(
                    v -> {
                      try {
                        String title = name.getText().toString().trim();
                        if (title.isEmpty()) throw new JSONException("Escribe un nombre");
                        JSONArray links = new JSONArray();
                        for (String line : streams.getText().toString().split("\\s+")) {
                          if (line.isEmpty()) continue;
                          String url = UserChannels.normalize(line);
                          if (url == null) throw new JSONException("Enlace no válido: " + line);
                          if (!contains(links, url)) links.put(url);
                        }
                        if (links.length() == 0)
                          throw new JSONException("Añade al menos un enlace");
                        String id =
                            existing == null
                                ? "mio-" + UUID.randomUUID()
                                : existing.getString("id");
                        JSONObject channel =
                            new JSONObject()
                                .put("id", id)
                                .put("name", title)
                                .put(
                                    "group",
                                    group.getText().toString().trim().isEmpty()
                                        ? "Calamar TV"
                                        : group.getText().toString().trim())
                                .put("logo", logo.getText().toString().trim())
                                .put("streams", links);
                        if (!channel.getString("logo").isEmpty()
                            && !channel.getString("logo").startsWith("https://"))
                          throw new JSONException("El logo debe usar https");
                        JSONObject next = copy();
                        JSONArray list = next.getJSONArray("channels");
                        boolean replaced = false;
                        for (int i = 0; i < list.length(); i++)
                          if (list.getJSONObject(i).getString("id").equals(id)) {
                            list.put(i, channel);
                            replaced = true;
                            break;
                          }
                        if (!replaced) list.put(channel);
                        JSONArray stars = withoutId(next.getJSONArray("featured"), id);
                        if (featured.isChecked()) stars.put(id);
                        next.put("featured", stars);
                        dialog.dismiss();
                        publish(next);
                      } catch (Exception invalid) {
                        error.setText(invalid.getMessage());
                      }
                    }));
    dialog.show();
  }

  private void editEvent(JSONObject existing) {
    if (catalog == null || saving) return;
    JSONArray channels = catalog.optJSONArray("channels");
    if (channels == null || channels.length() == 0) { status.setText("Crea primero un canal para el evento."); return; }
    LinearLayout form = new LinearLayout(this);
    form.setOrientation(LinearLayout.VERTICAL);
    form.setPadding(dp(20), dp(8), dp(20), dp(8));
    EditText name = input(form, "Nombre del evento", existing == null ? "" : existing.optString("name"));
    String savedCover = existing == null ? "" : existing.optString("cover");
    EditText cover = input(form, "Enlace HTTPS de la foto de portada", savedCover.startsWith("https://") ? savedCover : "");
    cover.setTag(savedCover);
    if (savedCover.startsWith("data:image/")) cover.setHint("Portada guardada. Pega un enlace para cambiarla.");
    Button upload = new Button(this);
    upload.setText("Elegir foto de portada"); upload.setAllCaps(false);
    upload.setOnClickListener(v -> {
      pendingCover = cover;
      try { startActivityForResult(new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE), 300); }
      catch (android.content.ActivityNotFoundException missing) { cover.setError("Pega un enlace HTTPS a la imagen."); }
    });
    form.addView(upload);
    form.addView(label("La foto ocupa toda la carátula del evento.", 14));
    AutoCompleteTextView search = new AutoCompleteTextView(this);
    search.setHint("Buscar y seleccionar un canal creado"); search.setSingleLine(true); search.setThreshold(1);
    search.setContentDescription("Buscar canal del evento");
    java.util.List<String> names = new java.util.ArrayList<>();
    java.util.Map<String, String> ids = new java.util.HashMap<>();
    String initial = "";
    for (int i = 0; i < channels.length(); i++) {
      JSONObject c = channels.optJSONObject(i);
      if (c == null) continue;
      String label = c.optString("name") + " · " + (i + 1);
      names.add(label); ids.put(label, c.optString("id"));
      if (existing != null && c.optString("id").equals(existing.optString("channelId"))) initial = label;
    }
    search.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_dropdown_item_1line, names));
    search.setText(initial, false);
    form.addView(search, new LinearLayout.LayoutParams(-1, -2));
    TextView error = label("Selecciona el canal de la lista de sugerencias.", 14); form.addView(error);
    ScrollView scroll = new ScrollView(this); scroll.addView(form);
    AlertDialog dialog = new AlertDialog.Builder(this).setTitle(existing == null ? "Crear evento" : "Editar evento")
        .setView(scroll).setNegativeButton("Cancelar", null).setPositiveButton("Guardar y publicar", null).create();
    dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
      try {
        String title = name.getText().toString().trim(), photo = cover.getText().toString().trim();
        if (photo.isEmpty() && cover.getTag() instanceof String) photo = (String) cover.getTag();
        String channelId = ids.get(search.getText().toString());
        if (title.isEmpty()) throw new JSONException("Escribe el nombre del evento");
        if (!SharedCatalog.validCover(photo)) throw new JSONException("Elige una foto o pega un enlace HTTPS de portada");
        if (channelId == null) throw new JSONException("Selecciona un canal de las sugerencias");
        String id = existing == null ? "evento-" + UUID.randomUUID() : existing.getString("id");
        JSONObject event = new JSONObject().put("id", id).put("name", title).put("cover", photo).put("channelId", channelId);
        JSONObject next = copy();
        JSONArray events = next.optJSONArray("events");
        if (events == null) events = new JSONArray();
        boolean replaced = false;
        for (int i = 0; i < events.length(); i++) if (id.equals(events.getJSONObject(i).getString("id"))) { events.put(i, event); replaced = true; break; }
        if (!replaced) events.put(event);
        next.put("events", events); SharedCatalog.validate(next);
        dialog.dismiss(); publish(next);
      } catch (Exception invalid) { error.setText(invalid.getMessage()); }
    }));
    dialog.show();
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != 300 || resultCode != RESULT_OK || data == null || data.getData() == null || pendingCover == null) return;
    final EditText target = pendingCover; pendingCover = null;
    final Uri uri = data.getData();
    new android.os.AsyncTask<Void, Void, String>() {
      protected String doInBackground(Void... unused) {
        try {
          android.graphics.BitmapFactory.Options options = new android.graphics.BitmapFactory.Options();
          options.inJustDecodeBounds = true;
          try (java.io.InputStream in = getContentResolver().openInputStream(uri)) { android.graphics.BitmapFactory.decodeStream(in, null, options); }
          options.inSampleSize = 1;
          while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 960) options.inSampleSize *= 2;
          options.inJustDecodeBounds = false;
          android.graphics.Bitmap bitmap;
          try (java.io.InputStream in = getContentResolver().openInputStream(uri)) { bitmap = android.graphics.BitmapFactory.decodeStream(in, null, options); }
          if (bitmap == null) return null;
          try {
            for (int quality : new int[] {80, 65, 50, 35}) {
              java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
              bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, quality, out);
              String encoded = "data:image/jpeg;base64," + android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP);
              if (encoded.length() <= 130000) return encoded;
            }
          } finally { bitmap.recycle(); }
        } catch (Exception ignored) {}
        return null;
      }
      protected void onPostExecute(String cover) {
        if (isFinishing()) return;
        if (cover == null) target.setError("No se pudo preparar la foto. Prueba una imagen más pequeña.");
        else { target.setText(""); target.setTag(cover); target.setHint("Foto seleccionada. Pega un enlace para cambiarla."); Toast.makeText(AdminActivity.this, "Portada preparada", Toast.LENGTH_SHORT).show(); }
      }
    }.execute();
  }

  private JSONObject copy() throws JSONException {
    return new JSONObject(catalog.toString());
  }

  private static boolean contains(JSONArray array, String value) {
    if (array != null)
      for (int i = 0; i < array.length(); i++) if (value.equals(array.optString(i))) return true;
    return false;
  }

  private static JSONArray withoutId(JSONArray array, String id) throws JSONException {
    JSONArray out = new JSONArray();
    for (int i = 0; i < array.length(); i++)
      if (!id.equals(array.getString(i))) out.put(array.get(i));
    return out;
  }

  private static JSONArray withoutChannel(JSONArray array, String id) throws JSONException {
    JSONArray out = new JSONArray();
    for (int i = 0; i < array.length(); i++)
      if (!id.equals(array.getJSONObject(i).getString("id"))) out.put(array.get(i));
    return out;
  }

  private static String join(JSONArray links) {
    StringBuilder text = new StringBuilder();
    if (links != null)
      for (int i = 0; i < links.length(); i++) {
        if (i > 0) text.append('\n');
        text.append(links.optString(i));
      }
    return text.toString();
  }

  private void fail(Exception error) {
    if (!isFinishing()) status.setText("No se pudo completar la operación: " + error.getMessage());
  }

  private void openWeb() {
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(SharedCatalog.WEB_ADMIN)));
    } catch (android.content.ActivityNotFoundException error) {
      status.setText("Abre la web de Calamar TV en tu móvil y entra en Administración.");
    }
  }

  private int dp(int n) {
    return (int) (n * getResources().getDisplayMetrics().density + .5f);
  }

  private TextView label(String text, int size) {
    TextView view = new TextView(this);
    view.setText(text);
    view.setTextColor(FG);
    view.setTextSize(size);
    view.setPadding(0, dp(10), 0, dp(10));
    return view;
  }

  private void addButton(String text, Runnable action) {
    Button button = new Button(this);
    button.setText(text);
    button.setAllCaps(false);
    button.setTextColor(BG);
    button.setMinHeight(dp(48));
    GradientDrawable background = new GradientDrawable();
    background.setColor(ACC);
    background.setCornerRadius(dp(8));
    GradientDrawable focused = new GradientDrawable();
    focused.setColor(FG);
    focused.setCornerRadius(dp(8));
    focused.setStroke(dp(3), ACC);
    StateListDrawable states = new StateListDrawable();
    states.addState(new int[] {android.R.attr.state_focused}, focused);
    states.addState(new int[] {}, background);
    button.setBackground(states);
    button.setOnClickListener(v -> action.run());
    LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
    layout.setMargins(0, dp(6), 0, dp(6));
    body.addView(button, layout);
  }

  private EditText input(LinearLayout form, String hint, String value) {
    EditText input = new EditText(this);
    input.setHint(hint);
    input.setText(value);
    input.setSingleLine(true);
    input.setContentDescription(hint);
    form.addView(input, new LinearLayout.LayoutParams(-1, -2));
    return input;
  }
}
