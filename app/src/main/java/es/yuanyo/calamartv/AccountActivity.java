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
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
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

  private static final int SHEET = 0xff232323, CARD = 0xff2e2e2e;

  private void draw() {
    if (isFinishing()) return;
    if (phone != null && !phoneInline) return; // The phone sign-in screen stays until it ends.
    if (Profiles.user(this) == null) { signIn(); return; }
    if (editing != null && !editing.equals("all") && !editing.equals("cuenta") && !editing.equals("ayuda")) { profileForm(); return; }
    JSONObject current = Profiles.active();
    if ("all".equals(editing) || current == null) { manage(current == null); return; }
    if ("cuenta".equals(editing)) { accountFacts(); return; }
    if ("ayuda".equals(editing)) { help(); return; }
    sheet("Perfil", null);
    // The profile watching: big, with its name, the account's email and ✎ to edit it.
    FrameLayout card = new FrameLayout(this);
    card.setBackground(Ui.shape(this, CARD, 26, 0, 0));
    LinearLayout who = new LinearLayout(this);
    who.setOrientation(LinearLayout.VERTICAL);
    who.setGravity(Gravity.CENTER_HORIZONTAL);
    who.setPadding(dp(16), dp(22), dp(16), dp(24));
    who.addView(avatar(this, current, 120), new LinearLayout.LayoutParams(dp(120), dp(120)));
    TextView name = label(current.optString("name"), 22, Ui.FG);
    name.setGravity(Gravity.CENTER);
    who.addView(name);
    String mail = Profiles.user(this).getEmail();
    TextView email = label(mail == null ? "" : mail, 15, 0x99ffffff);
    email.setGravity(Gravity.CENTER);
    email.setPadding(0, 0, 0, 0);
    who.addView(email);
    card.addView(who, new FrameLayout.LayoutParams(-1, -2));
    TextView pencil = label("✎", 26, Ui.FG);
    pencil.setFocusable(true);
    pencil.setClickable(true);
    pencil.setPadding(dp(12), dp(6), dp(12), dp(6));
    pencil.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 999, 0));
    pencil.setContentDescription("Editar " + current.optString("name"));
    final String currentId = current.optString("id");
    pencil.setOnClickListener(v -> { editing = currentId; draw(); });
    card.addView(pencil, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END));
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1, -2);
    cp.setMargins(0, dp(8), 0, dp(18));
    body.addView(card, cp);
    // The other profiles (pick one) and «Añadir».
    LinearLayout others = new LinearLayout(this);
    others.setGravity(Gravity.CENTER);
    for (JSONObject profile : Profiles.profiles()) {
      if (profile.optString("id").equals(currentId)) continue;
      final String id = profile.optString("id");
      others.addView(tile(avatar(this, profile, 76), profile.optString("name"), 76, () -> { Profiles.choose(this, id, true); draw(); }));
    }
    if (Profiles.profiles().size() < ProfileData.MAX_PROFILES) others.addView(tile(tool("+", 76), "Añadir", 76, () -> { editing = "new"; draw(); }));
    HorizontalScrollView othersScroll = new HorizontalScrollView(this);
    othersScroll.setHorizontalScrollBarEnabled(false);
    othersScroll.addView(others);
    LinearLayout.LayoutParams op = new LinearLayout.LayoutParams(-2, -2);
    op.gravity = Gravity.CENTER_HORIZONTAL;
    body.addView(othersScroll, op);
    Button manage = Ui.pill(this, "Administrar perfiles", Ui.Kind.SURFACE, false);
    manage.setOnClickListener(v -> { editing = "all"; draw(); });
    LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(-2, dp(52));
    mp.gravity = Gravity.CENTER_HORIZONTAL;
    mp.setMargins(0, dp(16), 0, dp(20));
    body.addView(manage, mp);
    menuItem("👤", "Cuenta", () -> { editing = "cuenta"; draw(); });
    menuItem("？", "Ayuda", () -> { editing = "ayuda"; draw(); });
    if (SharedCatalog.administrator(Profiles.user(this))) menuItem("⚙", "Administración", () -> startActivity(new Intent(this, AdminActivity.class)));
    menuItem("⇥", "Cerrar sesión", () -> SharedCatalog.auth(this).signOut());
    body.addView(status);
    manage.requestFocus();
  }

  /** A dark sheet as Netflix's «Perfil»: its title, ✕ to close and, inside it, ‹ to go back. */
  private void sheet(String heading, String back) {
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(SHEET);
    body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    body.setPadding(dp(18), dp(12), dp(18), dp(32));
    body.setFitsSystemWindows(true);
    scroll.addView(body);
    setContentView(scroll);
    FrameLayout head = new FrameLayout(this);
    TextView title = label(heading, 24, Ui.FG);
    title.setGravity(Gravity.CENTER);
    head.addView(title, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER));
    if (back != null) {
      TextView b = round("‹", 30);
      b.setContentDescription("Volver");
      b.setOnClickListener(v -> { editing = back.isEmpty() ? null : back; draw(); });
      head.addView(b, new FrameLayout.LayoutParams(dp(44), dp(44), Gravity.START | Gravity.CENTER_VERTICAL));
    }
    TextView close = round("✕", 18);
    close.setContentDescription("Cerrar");
    close.setBackground(Ui.focusFill(this, 0x26ffffff, 0x44ffffff, Ui.ACC, 999, 0));
    close.setOnClickListener(v -> finish());
    head.addView(close, new FrameLayout.LayoutParams(dp(44), dp(44), Gravity.END | Gravity.CENTER_VERTICAL));
    body.addView(head, new LinearLayout.LayoutParams(-1, dp(56)));
    status = label("", 15, Ui.MUTED);
    status.setGravity(Gravity.CENTER);
    status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
  }

  private TextView round(String text, int size) {
    TextView v = label(text, size, Ui.FG);
    v.setGravity(Gravity.CENTER);
    v.setPadding(0, 0, 0, 0);
    v.setFocusable(true);
    v.setClickable(true);
    v.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 999, 0));
    return v;
  }

  private View tile(View picture, String name, int size, Runnable action) {
    LinearLayout tile = new LinearLayout(this);
    tile.setOrientation(LinearLayout.VERTICAL);
    tile.setGravity(Gravity.CENTER_HORIZONTAL);
    tile.setPadding(dp(6), dp(6), dp(6), dp(6));
    tile.setFocusable(true);
    tile.setClickable(true);
    tile.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, 0xffffffff, 14, 0));
    tile.addView(picture, new LinearLayout.LayoutParams(dp(size), dp(size)));
    TextView label = label(name, 15, Ui.FG);
    label.setGravity(Gravity.CENTER);
    label.setPadding(0, dp(6), 0, 0);
    tile.addView(label);
    tile.setContentDescription(name);
    tile.setOnClickListener(v -> action.run());
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
    lp.setMargins(dp(6), 0, dp(6), 0);
    tile.setLayoutParams(lp);
    return tile;
  }

  private TextView tool(String symbol, int size) {
    TextView v = new TextView(this);
    v.setText(symbol);
    v.setTextColor(Color.WHITE);
    v.setTextSize(size * 0.4f);
    v.setGravity(Gravity.CENTER);
    v.setBackground(Ui.shape(this, 0xff3a3a3a, 12, 0, 0));
    return v;
  }

  /** A row of the sheet: icon, name and «›». */
  private void menuItem(String icon, String text, Runnable action) {
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setPadding(dp(20), dp(18), dp(18), dp(18));
    row.setFocusable(true);
    row.setClickable(true);
    row.setBackground(Ui.focusFill(this, CARD, 0xff383838, Ui.ACC, 14, 0));
    TextView i = label(icon, 22, Ui.FG);
    i.setPadding(0, 0, 0, 0);
    i.setGravity(Gravity.CENTER);
    row.addView(i, new LinearLayout.LayoutParams(dp(34), -2));
    TextView t = label(text, 18, Ui.FG);
    t.setPadding(dp(14), 0, 0, 0);
    row.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
    TextView chevron = label("›", 28, 0xccffffff);
    chevron.setPadding(0, 0, 0, 0);
    row.addView(chevron);
    row.setContentDescription(text);
    row.setOnClickListener(v -> action.run());
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
    lp.setMargins(0, dp(6), 0, dp(6));
    body.addView(row, lp);
  }

  /** «¿Quién está viendo?» (no profile chosen yet) or «Administrar perfiles» (✎ on each one). */
  private void manage(boolean choosing) {
    sheet(choosing ? "¿Quién está viendo?" : "Administrar perfiles", choosing ? null : "");
    LinearLayout grid = new LinearLayout(this);
    grid.setOrientation(LinearLayout.VERTICAL);
    LinearLayout row = null;
    int i = 0;
    for (JSONObject profile : Profiles.profiles()) {
      if (i++ % 3 == 0) { row = new LinearLayout(this); row.setGravity(Gravity.CENTER); grid.addView(row, new LinearLayout.LayoutParams(-1, -2)); }
      final String id = profile.optString("id");
      row.addView(tile(avatar(this, profile, 96), profile.optString("name") + (choosing ? "" : "  ✎"), 96,
          () -> { if (choosing) { Profiles.choose(this, id, true); finish(); } else { editing = id; draw(); } }));
    }
    if (Profiles.profiles().size() < ProfileData.MAX_PROFILES) {
      if (i % 3 == 0 || row == null) { row = new LinearLayout(this); row.setGravity(Gravity.CENTER); grid.addView(row, new LinearLayout.LayoutParams(-1, -2)); }
      row.addView(tile(tool("+", 96), "Añadir perfil", 96, () -> { editing = "new"; draw(); }));
    }
    body.addView(grid);
    if (!choosing) button("Listo", Ui.Kind.ACCENT, () -> { editing = null; draw(); });
    else button("Cerrar sesión", Ui.Kind.SURFACE, () -> SharedCatalog.auth(this).signOut());
    body.addView(status);
  }

  private void accountFacts() {
    sheet("Cuenta", "");
    com.google.firebase.auth.FirebaseUser user = Profiles.user(this);
    boolean google = false;
    for (com.google.firebase.auth.UserInfo info : user.getProviderData()) if ("google.com".equals(info.getProviderId())) google = true;
    LinearLayout facts = new LinearLayout(this);
    facts.setOrientation(LinearLayout.VERTICAL);
    facts.setPadding(dp(18), dp(12), dp(18), dp(12));
    facts.setBackground(Ui.shape(this, CARD, 14, 0, 0));
    facts.addView(label("Email:  " + (user.getEmail() == null ? "—" : user.getEmail()), 16, Ui.FG));
    facts.addView(label("Acceso:  " + (google ? "Google" : "Email y contraseña"), 16, Ui.FG));
    facts.addView(label("Perfiles:  " + Profiles.profiles().size() + " de " + ProfileData.MAX_PROFILES, 16, Ui.FG));
    body.addView(facts);
    if (!google && user.getEmail() != null) {
      final String mail = user.getEmail();
      button("Cambiar la contraseña", Ui.Kind.SURFACE, () -> SharedCatalog.auth(this).sendPasswordResetEmail(mail)
          .addOnSuccessListener(v -> say("Te hemos enviado un correo a " + mail + " para cambiar la contraseña."))
          .addOnFailureListener(error -> say(explain(error))));
    }
    body.addView(status);
  }

  private void help() {
    sheet("Ayuda", "");
    String[][] faq = {
      {"¿Para qué sirven los perfiles?", "Cada perfil tiene su «Continuar viendo», su lista, sus «Me gusta», sus canales favoritos y sus recomendaciones. Una cuenta puede tener hasta cinco."},
      {"¿Cómo entro en la tele?", "En «Entrar», elige «Con QR», enfoca el código con el móvil y confirma el código con tu cuenta de Google. También puedes escribir tu email y contraseña."},
      {"He olvidado la contraseña", "En «Entrar», escribe tu email y pulsa «¿Olvidaste tu contraseña?»: te llegará un correo para cambiarla."},
    };
    for (String[] qa : faq) {
      LinearLayout box = new LinearLayout(this);
      box.setOrientation(LinearLayout.VERTICAL);
      box.setPadding(dp(18), dp(10), dp(18), dp(12));
      box.setBackground(Ui.shape(this, CARD, 14, 0, 0));
      TextView q = label(qa[0], 17, Ui.FG);
      q.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      box.addView(q);
      box.addView(label(qa[1], 15, 0xccffffff));
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
      lp.setMargins(0, dp(6), 0, dp(6));
      body.addView(box, lp);
    }
  }

  private void profileForm() {
    JSONObject profile = null;
    for (JSONObject p : Profiles.profiles()) if (p.optString("id").equals(editing)) profile = p;
    if (!"new".equals(editing) && profile == null) { editing = null; draw(); return; }
    sheet(profile == null ? "Añadir perfil" : "Editar perfil", "");
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

  // ---- Signing in, as a card: brand, «Iniciar sesión» / «Crear cuenta», Google, «O continuar con» ----
  private boolean creating, byQr, phoneInline;

  private void signIn() {
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(Ui.BG);
    scroll.setFillViewport(true);
    LinearLayout outer = new LinearLayout(this);
    outer.setOrientation(LinearLayout.VERTICAL);
    outer.setGravity(Gravity.CENTER_HORIZONTAL);
    outer.setPadding(dp(16), dp(12), dp(16), dp(24));
    outer.setFitsSystemWindows(true);
    scroll.addView(outer);
    setContentView(scroll);
    body = outer;
    Button back = button("‹ Volver", Ui.Kind.GHOST, () -> { stopPhoneLogin(); finish(); });
    LinearLayout.LayoutParams bl = (LinearLayout.LayoutParams) back.getLayoutParams();
    bl.width = -2; bl.gravity = Gravity.START;
    // The brand, half over the card.
    LinearLayout brand = new LinearLayout(this);
    brand.setGravity(Gravity.CENTER_VERTICAL);
    brand.setPadding(dp(6), dp(6), dp(22), dp(6));
    brand.setBackground(Ui.shape(this, 0xff1a212c, 999, 1, 0x14ffffff));
    brand.setElevation(dp(6));
    ImageView logo = new ImageView(this);
    logo.setImageResource(R.drawable.calamar_menciano_tv);
    logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
    logo.setPadding(dp(5), dp(5), dp(5), dp(5));
    logo.setBackground(Ui.shape(this, Ui.BG, 999, 0, 0));
    brand.addView(logo, new LinearLayout.LayoutParams(dp(60), dp(60)));
    LinearLayout names = new LinearLayout(this);
    names.setOrientation(LinearLayout.VERTICAL);
    names.setPadding(dp(12), 0, 0, 0);
    TextView brandName = label("Calamar TV", 20, Ui.FG);
    brandName.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    brandName.setPadding(0, 0, 0, 0);
    names.addView(brandName);
    TextView claim = label("TU TELEVISIÓN, FÚTBOL Y CINE", 10, 0x99ffffff);
    claim.setLetterSpacing(0.14f);
    claim.setPadding(0, 0, 0, 0);
    names.addView(claim);
    brand.addView(names);
    LinearLayout.LayoutParams brandParams = new LinearLayout.LayoutParams(-2, -2);
    brandParams.gravity = Gravity.CENTER_HORIZONTAL;
    brandParams.setMargins(0, dp(10), 0, dp(-36));
    outer.addView(brand, brandParams);
    brand.bringToFront();
    LinearLayout card = new LinearLayout(this);
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(dp(22), dp(52), dp(22), dp(24));
    card.setBackground(Ui.shape(this, 0xff131922, 22, 1, 0x12ffffff));
    LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(Math.min(-1, -1), -2);
    cardParams.width = getResources().getConfiguration().screenWidthDp >= 600 ? dp(460) : -1;
    outer.addView(card, cardParams);
    brand.setTranslationZ(dp(8));
    body = card;
    // «Iniciar sesión» / «Crear cuenta».
    LinearLayout tabs = new LinearLayout(this);
    tabs.setPadding(dp(5), dp(5), dp(5), dp(5));
    tabs.setBackground(Ui.shape(this, 0xff0f141b, 14, 1, 0x14ffffff));
    tabs.addView(tab("Iniciar sesión", !creating, () -> { creating = false; signIn(); }), new LinearLayout.LayoutParams(0, dp(46), 1));
    tabs.addView(tab("Crear cuenta", creating, () -> { creating = true; byQr = false; stopPhoneLogin(); signIn(); }), new LinearLayout.LayoutParams(0, dp(46), 1));
    card.addView(tabs, new LinearLayout.LayoutParams(-1, -2));
    TextView title = label(creating ? "Crea tu cuenta" : "Entra", 32, Ui.FG);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setPadding(0, dp(22), 0, dp(2));
    card.addView(title);
    card.addView(label(creating ? "Regístrate con:" : "Inicia sesión o regístrate con:", 15, 0xaaffffff));
    Button google = Ui.pill(this, "G   Google", Ui.Kind.GHOST, false);
    google.setOnClickListener(v -> google());
    card.addView(google, new LinearLayout.LayoutParams(-1, dp(52)));
    // «O continuar con».
    LinearLayout divider = new LinearLayout(this);
    divider.setGravity(Gravity.CENTER_VERTICAL);
    divider.setPadding(0, dp(18), 0, dp(6));
    View left = new View(this), right = new View(this);
    left.setBackgroundColor(0x22ffffff); right.setBackgroundColor(0x22ffffff);
    divider.addView(left, new LinearLayout.LayoutParams(0, dp(1), 1));
    TextView or = label("O CONTINUAR CON", 12, 0x99ffffff);
    or.setLetterSpacing(0.16f);
    or.setPadding(dp(12), 0, dp(12), 0);
    divider.addView(or);
    divider.addView(right, new LinearLayout.LayoutParams(0, dp(1), 1));
    card.addView(divider);
    // «Contraseña» / «Con QR» (the QR is how a television signs in with a phone).
    LinearLayout methods = new LinearLayout(this);
    methods.addView(method("Contraseña", !byQr, () -> { byQr = false; stopPhoneLogin(); signIn(); }));
    if (!creating) methods.addView(method("Con QR", byQr, () -> { byQr = true; signIn(); }));
    card.addView(methods);
    if (byQr && !creating) qrInline(card); else passwordForm(card);
    status = label("", 15, Ui.MUTED);
    status.setGravity(Gravity.CENTER);
    status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    card.addView(status);
    body = outer;
    TextView foot = label("Con tu cuenta, lo que ves, tu lista, tus «Me gusta» y tus canales favoritos te siguen en la web, el móvil y la tele.", 13, 0x88ffffff);
    foot.setGravity(Gravity.CENTER);
    outer.addView(foot);
    Button admin = button("Administración", Ui.Kind.GHOST, () -> startActivity(new Intent(this, AdminActivity.class)));
    LinearLayout.LayoutParams al = (LinearLayout.LayoutParams) admin.getLayoutParams();
    al.width = -2; al.gravity = Gravity.CENTER_HORIZONTAL;
    (byQr ? google : tabs.getChildAt(creating ? 1 : 0)).requestFocus();
  }

  private View tab(String text, boolean on, Runnable action) {
    TextView t = label(text, 16, on ? Ui.FG : 0x99ffffff);
    t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    t.setGravity(Gravity.CENTER);
    t.setPadding(0, 0, 0, 0);
    t.setFocusable(true);
    t.setClickable(true);
    t.setBackground(Ui.focusFill(this, on ? 0xff1c2430 : 0x00000000, 0xff28323f, Ui.ACC, 10, 0));
    t.setOnClickListener(v -> action.run());
    return t;
  }

  private View method(String text, boolean on, Runnable action) {
    TextView t = label(text, 16, on ? Ui.ACC : 0xccffffff);
    t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    t.setPadding(dp(4), dp(10), dp(4), dp(8));
    t.setFocusable(true);
    t.setClickable(true);
    android.graphics.drawable.GradientDrawable line = new android.graphics.drawable.GradientDrawable();
    line.setColor(0x00000000);
    android.graphics.drawable.LayerDrawable under = new android.graphics.drawable.LayerDrawable(new android.graphics.drawable.Drawable[] {
        Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 6, 0), Ui.shape(this, on ? Ui.ACC : 0x00000000, 0, 0, 0)});
    under.setLayerInsetTop(1, dp(36));
    t.setBackground(under);
    t.setOnClickListener(v -> action.run());
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
    lp.setMargins(0, 0, dp(22), 0);
    t.setLayoutParams(lp);
    return t;
  }

  private TextView fieldLabel(LinearLayout card, String text) {
    TextView l = label(text, 12, 0xbbffffff);
    l.setLetterSpacing(0.14f);
    l.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    l.setPadding(0, dp(14), 0, dp(4));
    card.addView(l);
    return l;
  }

  private EditText field(LinearLayout card, String hint, int type) {
    EditText e = new EditText(this);
    e.setHint(hint);
    e.setSingleLine(true);
    e.setInputType(type);
    e.setTextColor(Ui.FG);
    e.setHintTextColor(0x77ffffff);
    e.setBackground(Ui.focusFill(this, 0xff0f141b, 0xff0f141b, Ui.ACC, 12, 0x1fffffff));
    e.setPadding(dp(16), dp(14), dp(16), dp(14));
    card.addView(e, new LinearLayout.LayoutParams(-1, -2));
    return e;
  }

  private void passwordForm(LinearLayout card) {
    EditText name = null;
    if (creating) { fieldLabel(card, "NOMBRE"); name = field(card, "Cómo te llamas", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS); }
    fieldLabel(card, "EMAIL");
    final EditText email = field(card, "Tu email", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
    LinearLayout passRow = new LinearLayout(this);
    passRow.setGravity(Gravity.CENTER_VERTICAL);
    TextView passLabel = label("CONTRASEÑA", 12, 0xbbffffff);
    passLabel.setLetterSpacing(0.14f);
    passLabel.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    passLabel.setPadding(0, dp(14), 0, dp(4));
    passRow.addView(passLabel, new LinearLayout.LayoutParams(0, -2, 1));
    card.addView(passRow, new LinearLayout.LayoutParams(-1, -2));
    FrameLayout passBox = new FrameLayout(this);
    final EditText password = new EditText(this);
    password.setHint("Contraseña");
    password.setSingleLine(true);
    password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
    password.setTextColor(Ui.FG);
    password.setHintTextColor(0x77ffffff);
    password.setBackground(Ui.focusFill(this, 0xff0f141b, 0xff0f141b, Ui.ACC, 12, 0x1fffffff));
    password.setPadding(dp(16), dp(14), dp(56), dp(14));
    passBox.addView(password, new FrameLayout.LayoutParams(-1, -2));
    ImageView eye = new ImageView(this);
    eye.setImageDrawable(Ui.icon(Ui.Icon.EYE, 0x99ffffff, dp(22)));
    eye.setScaleType(ImageView.ScaleType.CENTER);
    eye.setFocusable(true);
    eye.setClickable(true);
    eye.setContentDescription("Mostrar la contraseña");
    eye.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 8, 0));
    eye.setOnClickListener(v -> {
      boolean shown = (password.getInputType() & InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD;
      password.setInputType(InputType.TYPE_CLASS_TEXT | (shown ? InputType.TYPE_TEXT_VARIATION_PASSWORD : InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD));
      password.setSelection(password.getText().length());
      eye.setImageDrawable(Ui.icon(Ui.Icon.EYE, shown ? 0x99ffffff : Ui.ACC, dp(22)));
      eye.setContentDescription(shown ? "Mostrar la contraseña" : "Ocultar la contraseña");
    });
    passBox.addView(eye, new FrameLayout.LayoutParams(dp(44), dp(44), Gravity.END | Gravity.CENTER_VERTICAL));
    card.addView(passBox, new LinearLayout.LayoutParams(-1, -2));
    if (!creating) {
      TextView forgot = label("¿Olvidaste tu contraseña?", 13, 0xff8ab4ff);
      forgot.setPadding(dp(6), dp(14), dp(2), dp(4));
      forgot.setFocusable(true);
      forgot.setClickable(true);
      forgot.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 6, 0));
      forgot.setOnClickListener(v -> {
        String e = email.getText().toString().trim();
        if (e.isEmpty()) { say("Escribe tu email y vuelve a pulsar «¿Olvidaste tu contraseña?»."); email.requestFocus(); return; }
        SharedCatalog.auth(this).sendPasswordResetEmail(e)
            .addOnSuccessListener(x -> say("Te hemos enviado un correo a " + e + " para cambiar la contraseña."))
            .addOnFailureListener(error -> say(explain(error)));
      });
      passRow.addView(forgot);
    }
    Button submit = Ui.pill(this, creating ? "CREAR CUENTA" : "INICIAR SESIÓN", Ui.Kind.ACCENT, false);
    LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, dp(54));
    sp.setMargins(0, dp(22), 0, 0);
    card.addView(submit, sp);
    final EditText nameField = name;
    submit.setOnClickListener(v -> {
      String e = email.getText().toString().trim(), p = password.getText().toString();
      if (e.isEmpty() || p.length() < 6) { say("Escribe tu email y una contraseña de al menos 6 caracteres."); return; }
      if (!creating) {
        say("Entrando…");
        SharedCatalog.auth(this).signInWithEmailAndPassword(e, p).addOnFailureListener(error -> say(explain(error)));
        return;
      }
      final String n = nameField == null ? "" : nameField.getText().toString().trim();
      say("Creando la cuenta…");
      SharedCatalog.auth(this).createUserWithEmailAndPassword(e, p)
          .addOnSuccessListener(result -> { if (!n.isEmpty() && result.getUser() != null) result.getUser().updateProfile(new UserProfileChangeRequest.Builder().setDisplayName(n).build()); })
          .addOnFailureListener(error -> say(explain(error)));
    });
  }

  /** «Con QR»: the phone's camera opens the page, signs in with Google and confirms the code. */
  private void qrInline(LinearLayout card) {
    if (phone == null) {
      phone = DeviceLogin.create(new java.security.SecureRandom());
      phoneEnds = android.os.SystemClock.elapsedRealtime() + DeviceLogin.MINUTES * 60000L;
    }
    phoneInline = true;
    TextView first = label("1  Enfoca este código con la cámara del móvil, o ve a " + phone.shortLink(), 15, Ui.FG);
    first.setPadding(0, dp(14), 0, dp(6));
    card.addView(first);
    ImageView qr = new ImageView(this);
    qr.setImageBitmap(qrBitmap(phone.qrLink(), dp(200)));
    qr.setContentDescription("Código QR para iniciar sesión desde el móvil");
    LinearLayout.LayoutParams qp = new LinearLayout.LayoutParams(dp(200), dp(200));
    qp.gravity = Gravity.CENTER_HORIZONTAL;
    card.addView(qr, qp);
    card.addView(label("2  Entra con tu cuenta de Google en el móvil y confirma este código", 15, Ui.FG));
    TextView code = label(phone.code, 46, Ui.ACC);
    code.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
    code.setLetterSpacing(0.15f);
    code.setGravity(Gravity.CENTER);
    code.setContentDescription("Código " + String.join(" ", phone.code.split("")));
    card.addView(code);
    phoneStatus = label("", 14, Ui.MUTED);
    phoneStatus.setGravity(Gravity.CENTER);
    card.addView(phoneStatus);
    phoneHandler.removeCallbacks(phonePoll);
    phoneHandler.post(phonePoll);
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

  private final Runnable phonePoll = new Runnable() {
    @Override public void run() {
      if (phone == null || isFinishing()) return;
      long left = (phoneEnds - android.os.SystemClock.elapsedRealtime()) / 1000;
      if (left <= 0) { phone = null; signIn(); return; }
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
                .addOnSuccessListener(r -> { byQr = false; draw(); })
                .addOnFailureListener(error -> { signIn(); say("No se pudo iniciar sesión: " + error.getMessage() + ". Prueba con el código nuevo."); });
          });
      phoneHandler.postDelayed(this, 3000);
    }
  };

  private void stopPhoneLogin() {
    phone = null;
    phoneInline = false;
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
