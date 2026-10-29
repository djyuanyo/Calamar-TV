package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.GoogleAuthProvider;
import com.google.firebase.auth.UserProfileChangeRequest;
import com.google.firebase.firestore.Source;
import org.json.JSONObject;

/**
 * «Mi cuenta», as on the web (#/cuenta): sign in with Google, with email and password or from the phone
 * (QR and code, for televisions), then the profiles of the account (add, rename, colour, delete) and
 * «Administración». Whatever each profile saves is in Profiles.
 */
public class AccountActivity extends Activity {
  private LinearLayout body;
  private TextView status;
  private String editing; // null, "new" or the id of the profile being edited
  private final Profiles.Listener redraw = () -> runOnUiThread(this::draw);
  private FirebaseAuth.AuthStateListener authListener;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    Profiles.start(this);
    editing = getIntent().getStringExtra("editing");
    draw();
  }

  @Override
  protected void onStart() {
    super.onStart();
    Profiles.listen(redraw);
    try {
      authListener = auth -> runOnUiThread(this::draw);
      SharedCatalog.auth(this).addAuthStateListener(authListener);
    } catch (RuntimeException unavailable) { authListener = null; }
  }

  @Override
  protected void onStop() {
    Profiles.forget(redraw);
    if (authListener != null) SharedCatalog.auth(this).removeAuthStateListener(authListener);
    stopPhoneLogin();
    super.onStop();
  }

  private int dp(int n) { return Ui.dp(this, n); }

  private void page(String heading) {
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(Ui.BG);
    body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    body.setGravity(Gravity.CENTER_HORIZONTAL);
    body.setPadding(dp(20), dp(16), dp(20), dp(32));
    body.setFitsSystemWindows(true);
    scroll.addView(body);
    setContentView(scroll);
    Button back = button("‹ Volver", Ui.Kind.SURFACE, this::finish);
    ((LinearLayout.LayoutParams) back.getLayoutParams()).gravity = Gravity.START;
    TextView title = label(heading, 26, Ui.FG);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    body.addView(title);
    status = label("", 15, Ui.MUTED);
    status.setGravity(Gravity.CENTER);
    status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
  }

  private TextView label(String text, int size, int color) {
    TextView view = new TextView(this);
    view.setText(text);
    view.setTextColor(color);
    view.setTextSize(size);
    view.setPadding(0, dp(8), 0, dp(8));
    return view;
  }

  private Button button(String text, Ui.Kind kind, Runnable action) {
    Button b = Ui.pill(this, text, kind, false);
    b.setOnClickListener(v -> action.run());
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(48));
    lp.setMargins(0, dp(6), 0, dp(6));
    body.addView(b, lp);
    return b;
  }

  private EditText input(String hint, int type) {
    EditText e = new EditText(this);
    e.setHint(hint);
    e.setSingleLine(true);
    e.setInputType(type);
    e.setTextColor(Ui.FG);
    e.setHintTextColor(Ui.MUTED);
    e.setBackground(Ui.focusFill(this, Ui.SURFACE, 0x33ffffff, Ui.ACC, 12, 0));
    e.setPadding(dp(16), dp(12), dp(16), dp(12));
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.setMargins(0, dp(6), 0, dp(6));
    body.addView(e, lp);
    return e;
  }

  private void say(String text) { if (status != null) status.setText(text); }

  /** A profile's square: its colour and initial (as on the web). */
  static TextView avatar(Activity a, JSONObject profile, int sizeDp) {
    TextView v = new TextView(a);
    String name = profile.optString("name", "?").trim();
    v.setText(name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase(new java.util.Locale("es")));
    v.setTextColor(Color.WHITE);
    v.setTextSize(sizeDp * 0.42f);
    v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    v.setGravity(Gravity.CENTER);
    int color;
    try { color = Color.parseColor(profile.optString("color", ProfileData.COLORS[0])); } catch (IllegalArgumentException bad) { color = 0xffe50914; }
    v.setBackground(Ui.shape(a, color, 12, 0, 0));
    return v;
  }

  private void draw() {
    if (isFinishing()) return;
    if (phone != null) return; // The phone sign-in screen stays until it ends.
    if (Profiles.user(this) == null) { signIn(); return; }
    if (editing != null) { profileForm(); return; }
    page("Mi cuenta");
    TextView who = label("Cuenta: " + (Profiles.user(this).getEmail() == null ? "" : Profiles.user(this).getEmail()), 14, Ui.MUTED);
    who.setGravity(Gravity.CENTER);
    body.addView(who);
    body.addView(status);
    TextView pick = label("Elige tu perfil", 18, Ui.FG);
    pick.setGravity(Gravity.CENTER);
    body.addView(pick);
    LinearLayout grid = new LinearLayout(this);
    grid.setOrientation(LinearLayout.VERTICAL);
    body.addView(grid);
    JSONObject current = Profiles.active();
    for (JSONObject profile : Profiles.profiles()) {
      LinearLayout row = new LinearLayout(this);
      row.setGravity(Gravity.CENTER_VERTICAL);
      row.setPadding(dp(8), dp(6), dp(8), dp(6));
      row.setFocusable(true);
      row.setClickable(true);
      row.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 12, 0));
      row.addView(avatar(this, profile, 56), new LinearLayout.LayoutParams(dp(56), dp(56)));
      boolean on = current != null && current.optString("id").equals(profile.optString("id"));
      TextView name = label(profile.optString("name") + (on ? "  · viendo ahora" : ""), 18, on ? Ui.ACC : Ui.FG);
      name.setPadding(dp(14), 0, 0, 0);
      row.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
      TextView edit = label("✎ Modificar", 14, Ui.MUTED);
      row.addView(edit);
      final String id = profile.optString("id");
      row.setOnClickListener(v -> { Profiles.choose(this, id, true); finish(); });
      row.setOnLongClickListener(v -> { editing = id; draw(); return true; });
      edit.setOnClickListener(v -> { editing = id; draw(); });
      grid.addView(row, new LinearLayout.LayoutParams(-1, -2));
    }
    TextView hint = label("Pulsa un perfil para verlo, o «Modificar» (mantén pulsado con el mando) para cambiarlo.", 13, Ui.MUTED);
    hint.setGravity(Gravity.CENTER);
    body.addView(hint);
    if (Profiles.profiles().size() < ProfileData.MAX_PROFILES) button("+ Añadir perfil", Ui.Kind.ACCENT, () -> { editing = "new"; draw(); });
    button("Cerrar sesión", Ui.Kind.SURFACE, () -> SharedCatalog.auth(this).signOut());
    button("Administración", Ui.Kind.GHOST, () -> startActivity(new Intent(this, AdminActivity.class)));
  }

  private void profileForm() {
    JSONObject profile = null;
    for (JSONObject p : Profiles.profiles()) if (p.optString("id").equals(editing)) profile = p;
    if (!"new".equals(editing) && profile == null) { editing = null; draw(); return; }
    page(profile == null ? "Añadir perfil" : "Editar perfil");
    body.addView(status);
    final EditText name = input("Nombre del perfil", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
    if (profile != null) name.setText(profile.optString("name"));
    final String[] color = {profile != null ? profile.optString("color") : ProfileData.COLORS[Profiles.profiles().size() % ProfileData.COLORS.length]};
    LinearLayout colors = new LinearLayout(this);
    colors.setGravity(Gravity.CENTER);
    final java.util.List<View> dots = new java.util.ArrayList<>();
    for (final String c : ProfileData.COLORS) {
      View dot = new View(this);
      dot.setFocusable(true);
      dot.setClickable(true);
      dot.setContentDescription("Color " + (dots.size() + 1));
      dots.add(dot);
      dot.setOnClickListener(v -> { color[0] = c; paintDots(dots, color[0]); });
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(40), dp(40));
      lp.setMargins(dp(6), dp(8), dp(6), dp(8));
      colors.addView(dot, lp);
    }
    paintDots(dots, color[0]);
    body.addView(colors);
    final String id = profile == null ? null : profile.optString("id");
    button(profile == null ? "Añadir perfil" : "Guardar", Ui.Kind.ACCENT, () -> {
      try {
        if (id == null) Profiles.add(this, name.getText().toString(), color[0]); else Profiles.edit(this, id, name.getText().toString(), color[0]);
        editing = null; draw();
      } catch (RuntimeException error) { say(error.getMessage()); }
    });
    if (id != null && !id.equals("main")) button("Borrar perfil", Ui.Kind.SURFACE, () -> new AlertDialog.Builder(this)
        .setTitle("¿Borrar el perfil?").setMessage("Se borran su historial, su lista y sus «Me gusta».")
        .setNegativeButton("Cancelar", null)
        .setPositiveButton("Borrar", (d, w) -> { try { Profiles.remove(this, id); editing = null; draw(); } catch (RuntimeException error) { say(error.getMessage()); } })
        .show());
    button("Cancelar", Ui.Kind.GHOST, () -> { editing = null; draw(); });
    name.requestFocus();
  }

  private void paintDots(java.util.List<View> dots, String chosen) {
    for (int i = 0; i < dots.size(); i++) {
      int color = Color.parseColor(ProfileData.COLORS[i]);
      dots.get(i).setBackground(Ui.focusFill(this, color, color, Ui.ACC, 999, ProfileData.COLORS[i].equals(chosen) ? Color.WHITE : 0));
    }
  }

  // ---- Signing in ----
  private void signIn() {
    page("Entra en Calamar TV");
    TextView intro = label("Con tu cuenta, lo que estés viendo, «Mi lista», tus «Me gusta» y tus canales favoritos te siguen en la web, el móvil y la tele. Cada perfil tiene los suyos.", 15, Ui.MUTED);
    intro.setGravity(Gravity.CENTER);
    body.addView(intro);
    body.addView(status);
    button("Continuar con Google", Ui.Kind.ACCENT, this::google);
    button("Iniciar sesión con el móvil", Ui.Kind.SURFACE, this::phoneLogin);
    TextView or = label("o con tu correo", 14, Ui.MUTED);
    or.setGravity(Gravity.CENTER);
    body.addView(or);
    final EditText email = input("Correo electrónico", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
    final EditText password = input("Contraseña", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    final EditText name = input("Tu nombre (para crear la cuenta)", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
    button("Entrar", Ui.Kind.ACCENT, () -> {
      String e = email.getText().toString().trim(), p = password.getText().toString();
      if (e.isEmpty() || p.isEmpty()) { say("Escribe tu correo y tu contraseña."); return; }
      say("Entrando…");
      SharedCatalog.auth(this).signInWithEmailAndPassword(e, p).addOnFailureListener(error -> say(explain(error)));
    });
    button("Crear cuenta", Ui.Kind.SURFACE, () -> {
      String e = email.getText().toString().trim(), p = password.getText().toString(), n = name.getText().toString().trim();
      if (e.isEmpty() || p.length() < 6) { say("Escribe tu correo y una contraseña de al menos 6 caracteres."); return; }
      say("Creando la cuenta…");
      SharedCatalog.auth(this).createUserWithEmailAndPassword(e, p)
          .addOnSuccessListener(result -> { if (!n.isEmpty() && result.getUser() != null) result.getUser().updateProfile(new UserProfileChangeRequest.Builder().setDisplayName(n).build()); })
          .addOnFailureListener(error -> say(explain(error)));
    });
    button("¿Has olvidado la contraseña?", Ui.Kind.GHOST, () -> {
      String e = email.getText().toString().trim();
      if (e.isEmpty()) { say("Escribe tu correo y vuelve a pulsar «¿Has olvidado la contraseña?»."); return; }
      SharedCatalog.auth(this).sendPasswordResetEmail(e)
          .addOnSuccessListener(v -> say("Te hemos enviado un correo a " + e + " para cambiar la contraseña."))
          .addOnFailureListener(error -> say(explain(error)));
    });
    button("Administración", Ui.Kind.GHOST, () -> startActivity(new Intent(this, AdminActivity.class)));
  }

  /** Firebase's errors in plain Spanish (as explain() on the web). */
  static String explain(Exception error) {
    String code = error instanceof com.google.firebase.auth.FirebaseAuthException ? ((com.google.firebase.auth.FirebaseAuthException) error).getErrorCode() : "";
    switch (code) {
      case "ERROR_INVALID_EMAIL": return "Ese correo no es válido.";
      case "ERROR_WRONG_PASSWORD": case "ERROR_INVALID_CREDENTIAL": case "ERROR_USER_NOT_FOUND": return "El correo o la contraseña no son correctos.";
      case "ERROR_EMAIL_ALREADY_IN_USE": return "Ya hay una cuenta con ese correo. Entra con él o recupera la contraseña.";
      case "ERROR_WEAK_PASSWORD": return "La contraseña tiene que tener al menos 6 caracteres.";
      case "ERROR_TOO_MANY_REQUESTS": return "Demasiados intentos. Espera un momento y vuelve a probar.";
      case "ERROR_OPERATION_NOT_ALLOWED": return "El acceso con correo y contraseña todavía no está activado.";
      default: return "No se pudo completar: " + (error.getMessage() == null ? "inténtalo de nuevo." : error.getMessage());
    }
  }

  private void google() {
    say("Abriendo Google…");
    try {
      GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(SharedCatalog.GOOGLE_CLIENT_ID).build();
      GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
      CredentialManager.create(this).getCredentialAsync(this, request, null, command -> runOnUiThread(command),
          new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
            @Override public void onResult(GetCredentialResponse response) {
              try {
                Credential credential = response.getCredential();
                if (!(credential instanceof CustomCredential) || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType()))
                  throw new IllegalStateException("Google no devolvió una cuenta compatible.");
                GoogleIdTokenCredential g = GoogleIdTokenCredential.createFrom(credential.getData());
                SharedCatalog.auth(AccountActivity.this).signInWithCredential(GoogleAuthProvider.getCredential(g.getIdToken(), null))
                    .addOnFailureListener(error -> say(explain(error)));
              } catch (Exception error) { say("No se pudo entrar con Google: " + error.getMessage()); }
            }
            @Override public void onError(GetCredentialException error) {
              say("No se completó el acceso con Google. En una tele, usa «Iniciar sesión con el móvil» o tu correo.");
            }
          });
    } catch (Exception error) { say("No se pudo abrir Google en este dispositivo. Usa «Iniciar sesión con el móvil» o tu correo."); }
  }

  // ---- From the phone, as on Netflix: QR + short link + code; the phone confirms with Google ----
  private final android.os.Handler phoneHandler = new android.os.Handler(android.os.Looper.getMainLooper());
  private DeviceLogin phone;
  private long phoneEnds;
  private TextView phoneStatus;

  private void phoneLogin() {
    stopPhoneLogin();
    phone = DeviceLogin.create(new java.security.SecureRandom());
    phoneEnds = android.os.SystemClock.elapsedRealtime() + DeviceLogin.MINUTES * 60000L;
    page("Iniciar sesión con el móvil");
    ((Button) body.getChildAt(0)).setOnClickListener(v -> { stopPhoneLogin(); draw(); });
    TextView first = label("1  Enfoca este código con la cámara del móvil, o ve a " + phone.shortLink(), 17, Ui.FG);
    first.setGravity(Gravity.CENTER);
    body.addView(first);
    ImageView qr = new ImageView(this);
    qr.setImageBitmap(qrBitmap(phone.qrLink(), dp(220)));
    qr.setContentDescription("Código QR para iniciar sesión desde el móvil");
    body.addView(qr, new LinearLayout.LayoutParams(dp(220), dp(220)));
    TextView second = label("2  Entra con tu cuenta de Google en el móvil y confirma este código", 17, Ui.FG);
    second.setGravity(Gravity.CENTER);
    body.addView(second);
    TextView code = label(phone.code, 52, Ui.ACC);
    code.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
    code.setLetterSpacing(0.15f);
    code.setGravity(Gravity.CENTER);
    code.setContentDescription("Código " + String.join(" ", phone.code.split("")));
    body.addView(code);
    phoneStatus = label("", 15, Ui.MUTED);
    phoneStatus.setGravity(Gravity.CENTER);
    body.addView(phoneStatus);
    phoneHandler.post(phonePoll);
  }

  private final Runnable phonePoll = new Runnable() {
    @Override public void run() {
      if (phone == null || isFinishing()) return;
      long left = (phoneEnds - android.os.SystemClock.elapsedRealtime()) / 1000;
      if (left <= 0) { phoneLogin(); return; }
      phoneStatus.setText("Esperando la confirmación del móvil… El código cambia en " + left / 60 + ":" + String.format(java.util.Locale.ROOT, "%02d", left % 60) + ".");
      final DeviceLogin asked = phone;
      com.google.firebase.firestore.FirebaseFirestore.getInstance(SharedCatalog.app(AccountActivity.this))
          .document(asked.document()).get(Source.SERVER)
          .addOnSuccessListener(snapshot -> {
            String idToken = snapshot.exists() ? snapshot.getString("idToken") : null;
            if (idToken == null || asked != phone) return;
            stopPhoneLogin();
            snapshot.getReference().delete(); // Used: the phone shows «Listo» and nobody can read it again.
            SharedCatalog.auth(AccountActivity.this).signInWithCredential(GoogleAuthProvider.getCredential(idToken, null))
                .addOnSuccessListener(r -> draw())
                .addOnFailureListener(error -> { phoneLogin(); phoneStatus.setText("No se pudo iniciar sesión: " + error.getMessage() + ". Prueba con el código nuevo."); });
          });
      phoneHandler.postDelayed(this, 3000);
    }
  };

  private void stopPhoneLogin() {
    phone = null;
    phoneHandler.removeCallbacks(phonePoll);
  }

  private static android.graphics.Bitmap qrBitmap(String text, int size) {
    try {
      com.google.zxing.common.BitMatrix m = new com.google.zxing.qrcode.QRCodeWriter()
          .encode(text, com.google.zxing.BarcodeFormat.QR_CODE, size, size, java.util.Collections.singletonMap(com.google.zxing.EncodeHintType.MARGIN, 2));
      int[] pixels = new int[size * size];
      for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) pixels[y * size + x] = m.get(x, y) ? Color.BLACK : Color.WHITE;
      return android.graphics.Bitmap.createBitmap(pixels, size, size, android.graphics.Bitmap.Config.ARGB_8888);
    } catch (com.google.zxing.WriterException impossible) {
      throw new IllegalStateException(impossible);
    }
  }
}
