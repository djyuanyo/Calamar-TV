package es.yuanyo.calamartv;

import android.app.*;
import android.content.Intent;
import android.graphics.*;
import android.graphics.drawable.*;
import android.net.Uri;
import android.os.*;
import android.util.LruCache;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.text.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Calamar TV: free-to-air TDT channels plus the administrator's channels, shared with the web. */
public class MainActivity extends Activity {
  /** Published by GitHub Pages from data/ in this repository (see .github/workflows/web.yml). */
  static final String CATALOG_BASE = "https://djyuanyo.github.io/Calamar-TV/data/";

  final int FG = Ui.FG, MUTED = Ui.MUTED;
  LinearLayout root, list, filters;
  ScrollView catalogScroll;
  AppUpdater updater;
  boolean television;
  final List<LazySection> lazySections = new ArrayList<>();
  final ExecutorService catalogWorker = Executors.newSingleThreadExecutor();
  final ExecutorService sharedWorker = Executors.newSingleThreadExecutor();
  // Several pictures at a time: a row of posters no longer comes in two by two.
  final ExecutorService imageWorker = Executors.newFixedThreadPool(6);
  final ExecutorService prefetchWorker = Executors.newSingleThreadExecutor();
  final Map<String, List<java.lang.ref.WeakReference<ImageView>>> pendingImages = new HashMap<>();
  int imageGeneration;
  long sharedServerAt;
  long sharedRevision = -1;
  boolean sharedRefreshBusy;
  int sharedSession;
  String lastRenderKey = "";
  final Runnable searchRender = this::render;
  final Runnable lazyUpdate = this::updateLazySections;

  TextView message;
  JSONObject tdt = new JSONObject(), custom = new JSONObject();
  List<Catalog.Channel> channels = new ArrayList<>();
  String query = "";
  final Set<String> favorites = new HashSet<>();
  String mode = "Inicio", group = "Todos", origin = "Catálogo incluido", loadError = "";
  long updatedAt = 0;
  boolean busy = false;
  boolean sharedAvailable = false;
  com.google.firebase.firestore.ListenerRegistration sharedListener;
  final LruCache<String, Bitmap> images =
      new LruCache<String, Bitmap>((int) Math.max(12L * 1024 * 1024, Runtime.getRuntime().maxMemory() / 6)) {
        protected int sizeOf(String k, Bitmap b) {
          return b.getByteCount();
        }
      };
  FrameLayout heroHost;
  List<Catalog.Channel> heroItems = Collections.emptyList();
  int heroIndex;
  boolean resumed;
  final Runnable heroAdvance = new Runnable() { public void run() {
    if (resumed && !television && heroHost != null && heroItems.size() > 1) { showHero((heroIndex + 1) % heroItems.size(), false); }
  }};
  final Handler handler = new Handler(Looper.getMainLooper());
  final Runnable refresh =
      new Runnable() {
        public void run() {
          load();
          handler.postDelayed(this, 10 * 60000);
        }
      };

  AppLink pendingAppLink;

  public void onCreate(Bundle b) {
    super.onCreate(b);
    television = getPackageManager().hasSystemFeature("android.software.leanback")
        || ((UiModeManager) getSystemService(UI_MODE_SERVICE)).getCurrentModeType()
            == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION;
    MatchScores.initialize(this);
    imageCacheDir = new File(getCacheDir(), "images");
    if (!imageCacheDir.isDirectory() && !imageCacheDir.mkdirs()) imageCacheDir = null;
    imageWorker.execute(MainActivity::trimImageCache);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
    updater = createUpdater();
    restore();
    favorites.addAll(getSharedPreferences("favorites", MODE_PRIVATE).getStringSet("ids", Collections.emptySet()));
    // Accounts and profiles: «Elige tu perfil» each time the app opens, and each profile's own rows.
    Profiles.start(this);
    Profiles.listen(profilesChanged);
    home();
    receiveAppLink(getIntent());
    // A signed-in account: «Elige tu perfil» at once, with the profiles kept on this device.
    if (Profiles.needsPick()) profileGate();
  }

  @Override protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    receiveAppLink(intent);
  }

  void receiveAppLink(Intent intent) {
    if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
    AppLink link = AppLink.parse(intent.getData().toString());
    if (link == null) return;
    pendingAppLink = link;
    handler.post(this::openPendingAppLink);
    handler.postDelayed(() -> {
      if (pendingAppLink == link && !Profiles.needsPick()) {
        pendingAppLink = null;
        Toast.makeText(this, "No se ha encontrado esta página. Actualiza el catálogo y vuelve a abrir el enlace.", Toast.LENGTH_LONG).show();
      }
    }, 30000);
  }

  /** Keep a new shared page pending while the catalog loads or the viewer chooses a profile. */
  void openPendingAppLink() {
    if (pendingAppLink == null || !resumed || Profiles.needsPick() || isFinishing()) return;
    AppLink link = pendingAppLink;
    String destination = null;
    Catalog.Channel selected = null;
    if ("liga".equals(link.page)) {
      for (java.util.Map.Entry<String, String> entry : SportsCatalog.leagueSlugs(custom).entrySet())
        if (link.slug.equals(entry.getValue()) || link.slug.equals(entry.getKey())) { destination = LEAGUE + entry.getKey(); break; }
    } else if ("evento".equals(link.page)) {
      java.util.Map<String, String> slugs = SportsCatalog.slugs(custom);
      for (Catalog.Channel channel : Catalog.events(channels, custom, System.currentTimeMillis(), true, true)) {
        String slug = slugs.get(channel.id);
        if (link.slug.equals(slug) || (link.slug + "-1").equals(slug) || link.slug.equals(channel.id)) { selected = channel; break; }
      }
    } else if ("canal".equals(link.page)) {
      java.util.Map<String, String> slugs = Catalog.slugs(channels);
      for (Catalog.Channel channel : channels)
        if (link.slug.equals(slugs.get(channel.id)) || link.slug.equals(channel.id)) { selected = channel; break; }
    } else {
      switch (link.page) {
        case "inicio": destination = "Inicio"; break;
        case "directo": destination = LIVE; break;
        case "canales": destination = "TV"; break;
        case "peliculas": destination = "Películas"; break;
        case "series": destination = "Series"; break;
        case "documentales": destination = "Documentales"; break;
        default: return;
      }
    }
    if (destination == null && selected == null) return;
    pendingAppLink = null;
    query = "";
    if (destination != null) { mode = destination; home(); }
    else if (selected.event && MatchScores.expired(selected.matchId, System.currentTimeMillis())) {
      startActivity(new Intent(this, MatchActivity.class).putExtra("title", selected.name)
          .putExtra("match_id", selected.matchId).putExtra("event_info", eventInfo(selected).toString()));
    } else open(selected);
  }

  /** «Elige tu perfil» while it is on screen. */
  Dialog gate;
  final Profiles.Listener profilesChanged = () -> runOnUiThread(() -> {
    if (isFinishing()) return;
    syncFavorites();
    if (Profiles.needsPick()) profileGate();
    else if (gate != null && gate.isShowing()) gate.dismiss();
    render();
    openPendingAppLink();
  });

  /** The favourite channels of the profile watching (those of this device without an account). */
  void syncFavorites() {
    if (Profiles.signedIn() && Profiles.active() != null) { favorites.clear(); favorites.addAll(ProfileData.favorites(Profiles.data())); }
    else { favorites.clear(); favorites.addAll(getSharedPreferences("favorites", MODE_PRIVATE).getStringSet("ids", Collections.emptySet())); }
  }

  /**
   * «Elige tu perfil», as on Netflix (and on the web): the film N.º 1 of the week behind, the profiles of
   * the account, «Añadir» and «Modificar». Once each time the app opens.
   */
  void profileGate() {
    if (gate != null && gate.isShowing()) return;
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Ui.BG);
    // Behind it the weekly top, one title after another every 6 seconds (those of the last time while the library loads).
    final ImageView art = new ImageView(this);
    art.setScaleType(ImageView.ScaleType.CENTER_CROP);
    root.addView(art, new FrameLayout.LayoutParams(-1, -1));
    if (library == null && libraryShown(custom)) loadLibrary();
    View shade = new View(this);
    shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0x220b0d10, 0x880b0d10, 0xff0b0d10}));
    root.addView(shade, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setGravity(Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM);
    box.setPadding(dp(16), dp(24), dp(16), dp(36));
    final TextView title = label("", wide() ? 44 : 34, 0xffffe000);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    title.setShadowLayer(dp(10), 0, dp(2), 0xcc000000);
    box.addView(title);
    final TextView rank = label("", 16, 0xffffffff);
    rank.setGravity(Gravity.CENTER);
    box.addView(rank);
    final int[] at = {0};
    gateSlide = new Runnable() { public void run() {
      if (gate == null || !gate.isShowing()) return;
      List<String[]> slides = gateSlides();
      if (!slides.isEmpty()) {
        String[] slide = slides.get(at[0] % slides.size());
        at[0]++;
        art.animate().alpha(0f).setDuration(at[0] == 1 ? 0 : 500).withEndAction(() -> {
          image(art, slide[1]);
          title.setText(slide[0].toUpperCase(new Locale("es")));
          rank.setText("TOP 10 · " + slide[2]);
          art.animate().alpha(1f).setDuration(700).start();
        }).start();
      }
      handler.postDelayed(this, slides.isEmpty() ? 1500 : 6000);
    }};
    TextView pick = label("Elige tu perfil", 17, 0xccffffff);
    pick.setGravity(Gravity.CENTER);
    pick.setPadding(0, dp(24), 0, dp(12));
    box.addView(pick);
    LinearLayout profiles = new LinearLayout(this);
    profiles.setGravity(Gravity.CENTER);
    View first = null;
    int size = wide() ? 104 : 88;
    for (JSONObject profile : Profiles.profiles()) {
      final String id = profile.optString("id");
      View tile = gateTile(AccountActivity.avatar(this, profile, size), profile.optString("name"), size);
      tile.setOnClickListener(v -> { Profiles.choose(this, id, true); if (gate != null) gate.dismiss(); });
      profiles.addView(tile);
      if (first == null) first = tile;
    }
    box.addView(profiles);
    LinearLayout tools = new LinearLayout(this);
    tools.setGravity(Gravity.CENTER);
    if (Profiles.profiles().size() < ProfileData.MAX_PROFILES) {
      View add = gateTile(gateTool("+", size), "Añadir", size);
      add.setOnClickListener(v -> startActivity(new Intent(this, AccountActivity.class).putExtra("editing", "new")));
      tools.addView(add);
    }
    View manage = gateTile(gateTool("✎", size), "Modificar", size);
    manage.setOnClickListener(v -> startActivity(new Intent(this, AccountActivity.class)));
    tools.addView(manage);
    box.addView(tools);
    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    LinearLayout fill = new LinearLayout(this);
    fill.setOrientation(LinearLayout.VERTICAL);
    fill.setGravity(Gravity.BOTTOM);
    fill.addView(box, new LinearLayout.LayoutParams(-1, -2));
    scroll.addView(fill, new FrameLayout.LayoutParams(-1, -1));
    root.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
    gate = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
    gate.setContentView(root);
    // Back leaves the app as on Netflix: a profile has to be chosen to go in.
    gate.setOnCancelListener(d -> finish());
    gate.setOnDismissListener(d -> handler.removeCallbacks(gateSlide));
    gate.show();
    handler.removeCallbacks(gateSlide);
    handler.post(gateSlide);
    if (first != null) first.requestFocus();
  }

  Runnable gateSlide;
  /** The titles behind «Elige tu perfil»: from the library (kept for next time), or those of the last time. */
  List<String[]> gateSlides() {
    List<String[]> slides = new ArrayList<>();
    if (library != null) {
      slides = Library.gateSlides(library, 12);
      JSONArray keep = new JSONArray();
      for (String[] slide : slides) keep.put(new JSONArray(Arrays.asList(slide)));
      getSharedPreferences("profiles", MODE_PRIVATE).edit().putString("gate_slides", keep.toString()).apply();
      return slides;
    }
    try {
      JSONArray kept = new JSONArray(getSharedPreferences("profiles", MODE_PRIVATE).getString("gate_slides", "[]"));
      for (int i = 0; i < kept.length(); i++) {
        JSONArray s = kept.optJSONArray(i);
        if (s != null && s.length() == 3 && s.optString(1).startsWith("https://")) slides.add(new String[] {s.optString(0), s.optString(1), s.optString(2)});
      }
    } catch (JSONException broken) { /* Nothing kept yet. */ }
    return slides;
  }

  View gateTile(View picture, String name, int size) {
    LinearLayout tile = new LinearLayout(this);
    tile.setOrientation(LinearLayout.VERTICAL);
    tile.setGravity(Gravity.CENTER_HORIZONTAL);
    tile.setPadding(dp(6), dp(6), dp(6), dp(6));
    tile.setFocusable(true);
    tile.setClickable(true);
    tile.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, 0xffffffff, 16, 0));
    Ui.scaleOnFocus(tile, 1.06f);
    picture.setDuplicateParentStateEnabled(true);
    tile.addView(picture, new LinearLayout.LayoutParams(dp(size), dp(size)));
    TextView label = label(name, 15, 0xffffffff);
    label.setGravity(Gravity.CENTER);
    label.setPadding(0, dp(8), 0, 0);
    tile.addView(label);
    tile.setContentDescription(name);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
    lp.setMargins(dp(8), dp(6), dp(8), dp(6));
    tile.setLayoutParams(lp);
    return tile;
  }

  TextView gateTool(String symbol, int size) {
    TextView v = new TextView(this);
    v.setText(symbol);
    v.setTextColor(0xffffffff);
    v.setTextSize(size * 0.38f);
    v.setGravity(Gravity.CENTER);
    v.setBackground(Ui.shape(this, 0x55ffffff, 12, 0, 0));
    return v;
  }

  // ---- Catalog -------------------------------------------------------------------------------

  JSONObject readJson(InputStream in) throws IOException, JSONException {
    return new JSONObject(Io.read(in));
  }

  void restore() {
    try {
      tdt = readJson(getAssets().open("tdt.json"));
      custom = readJson(getAssets().open("custom.json"));
      updatedAt = tdt.optLong("updated_at");
    } catch (Exception ignored) {
    }
    File t = new File(getFilesDir(), "catalog-tdt.json"),
        c = new File(getFilesDir(), "catalog-custom.json");
    if (t.isFile() && c.isFile())
      try {
        JSONObject savedTdt = readJson(new FileInputStream(t));
        JSONObject savedCustom = readJson(new FileInputStream(c));
        tdt = savedTdt;
        custom = savedCustom;
        updatedAt = Math.max(savedTdt.optLong("updated_at"), t.lastModified());
        origin = "Catálogo guardado";
      } catch (Exception ignored) {
      }
    JSONObject shared = SharedCatalog.cached(this);
    if (shared != null) {
      custom = shared;
      sharedAvailable = true;
    }
    channels = Catalog.merge(tdt, custom);
  }

  static JSONObject download(String name) throws IOException, JSONException {
    HttpURLConnection c =
        (HttpURLConnection)
            new URL(CATALOG_BASE + name + "?t=" + System.currentTimeMillis()).openConnection();
    c.setConnectTimeout(10000);
    c.setReadTimeout(15000);
    c.setUseCaches(false);
    c.setRequestProperty("Accept", "application/json");
    c.setRequestProperty("User-Agent", PlayerDocument.USER_AGENT);
    try {
      int status = c.getResponseCode();
      if (status != 200) throw new IOException("HTTP " + status);
      return new JSONObject(Io.read(c.getInputStream()));
    } finally {
      c.disconnect();
    }
  }

  void load() {
    refreshSharedCatalog();
    if (busy) return;
    busy = true;
    loadError = "";
    if (message != null) message.setText(status());
    new AsyncTask<Void, Void, JSONObject[]>() {
      String error;

      protected JSONObject[] doInBackground(Void... v) {
        try {
          JSONObject newTdt = download("tdt.json"), newCustom = download("custom.json");
          int playable = 0;
          for (Catalog.Channel c : Catalog.merge(newTdt, null)) if (c.playable()) playable++;
          if (playable < 40) throw new IOException("catálogo incompleto");
          Io.save(new File(getFilesDir(), "catalog-tdt.json"), newTdt.toString());
          Io.save(new File(getFilesDir(), "catalog-custom.json"), newCustom.toString());
          return new JSONObject[] {newTdt, newCustom};
        } catch (Exception e) {
          error =
              e instanceof UnknownHostException
                  ? "Sin conexión"
                  : e instanceof SocketTimeoutException
                      ? "El catálogo tarda en responder"
                      : "No se pudo actualizar el catálogo";
          return null;
        }
      }

      protected void onPostExecute(JSONObject[] result) {
        busy = false;
        if (isFinishing() || isDestroyed()) return;
        if (result != null) {
          tdt = result[0];
          // A cached Firestore copy must not pin an old catalog forever. A live server snapshot
          // remains authoritative; otherwise accept the fresh public copy when it contains channels.
          if (sharedServerAt == 0 && (!sharedAvailable || result[1].optJSONArray("channels") != null
              && result[1].optJSONArray("channels").length() > 0)) custom = result[1];
          channels = Catalog.merge(tdt, custom);
          updatedAt = System.currentTimeMillis();
          origin = "En línea";
        }
        loadError = error == null ? "" : error + " · Se muestra el último catálogo disponible.";
        View focused = getCurrentFocus();
        int focusId = focused != null ? focused.getId() : View.NO_ID;
        String renderKey = tdt.toString() + custom.toString();
        if (!renderKey.equals(lastRenderKey)) {
          lastRenderKey = renderKey;
          renderFilters();
          render();
        } else if (message != null) message.setText(status());
        openPendingAppLink();
        if (focusId != View.NO_ID && root != null) {
          View replacement = root.findViewById(focusId);
          if (replacement != null) replacement.requestFocus();
        }
      }
    }.executeOnExecutor(catalogWorker);
  }

  String status() {
    int playable = 0;
    for (Catalog.Channel c : channels) if (c.playable()) playable++;
    SimpleDateFormat stamp = new SimpleDateFormat("dd/MM HH:mm", Locale.getDefault());
    return "v" + BuildConfig.VERSION_NAME + " · " + origin
        + (busy ? " · Actualizando…" : "")
        + "  /  "
        + playable
        + " canales en directo"
        + (updatedAt > 0 ? "  /  " + stamp.format(new Date(updatedAt)) : "")
        + (loadError.isEmpty() ? "" : "\n" + loadError);
  }

  // ---- Layout --------------------------------------------------------------------------------

  int gutter() {
    return wide() ? 28 : 14;
  }

  void home() {
    root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(dp(gutter()), 0, dp(gutter()), 0);
    root.setBackgroundColor(Ui.BG);
    root.setFitsSystemWindows(true);
    setContentView(root);
    getWindow().setStatusBarColor(Ui.BG);
    getWindow().setNavigationBarColor(Ui.BG);

    LinearLayout mast = row();
    mast.setPadding(0, dp(10), 0, dp(2));
    android.widget.ImageView brand = new android.widget.ImageView(this);
    brand.setImageResource(R.drawable.calamar_menciano_tv);
    brand.setScaleType(android.widget.ImageView.ScaleType.FIT_START);
    brand.setContentDescription("Calamar Menciano TV");
    mast.addView(brand, new LinearLayout.LayoutParams(0, dp(wide() ? 86 : 68), 1));
    Button multiButton = Ui.pill(this, "Multipantalla", Ui.Kind.SURFACE, true);
    multiButton.setContentDescription("Multipantalla: ver varios canales a la vez");
    multiButton.setOnClickListener(v -> pickMulti());
    addButton(mast, multiButton);
    Button refreshButton =
        Ui.pill(this, "↻", Ui.Kind.SURFACE, true);
    refreshButton.setContentDescription("Actualizar el catálogo");
    refreshButton.setOnClickListener(
        new View.OnClickListener() {
          public void onClick(View v) {
            load();
          }
        });
    addButton(mast, refreshButton);
    Button updates = Ui.pill(this, "↓", Ui.Kind.SURFACE, true);
    updates.setContentDescription("Actualizaciones");
    updates.setOnClickListener(v -> { if (updater != null) updater.check(true); });
    addButton(mast, updates);
    // Icon only (account silhouette); the name stays for screen readers and as a tooltip.
    ImageButton admin = new ImageButton(this);
    admin.setImageDrawable(Ui.icon(Ui.Icon.ADMIN, Ui.MUTED, dp(22)));
    admin.setBackground(Ui.focusFill(this, 0, 0x22ffffff, Ui.ACC, 999, 0));
    admin.setContentDescription("Mi cuenta");
    if (android.os.Build.VERSION.SDK_INT >= 26) admin.setTooltipText("Mi cuenta");
    // «Mi cuenta»: sign in, the profiles and, from there, «Administración».
    admin.setOnClickListener(v -> startActivity(new Intent(this, AccountActivity.class)));
    LinearLayout.LayoutParams adminSize = new LinearLayout.LayoutParams(dp(44), dp(44));
    adminSize.setMargins(dp(4), dp(4), dp(4), dp(4));
    mast.addView(admin, adminSize);
    root.addView(mast);
    EditText search = new EditText(this);
    search.setSingleLine(true);
    search.setTextColor(Ui.FG);
    search.setHintTextColor(Ui.MUTED);
    search.setTextSize(16);
    String hint = Library.section(mode) != null ? "Buscar títulos" : "Buscar canales y eventos";
    search.setHint(hint);
    search.setContentDescription(hint);
    search.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
    search.setBackground(Ui.focusFill(this, Ui.SURFACE, 0x33ffffff, Ui.ACC, 24, 0));
    search.setPadding(dp(18), dp(10), dp(18), dp(10));
    search.setText(query);
    LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(-1, dp(48));
    searchParams.setMargins(0, dp(6), 0, dp(8));
    root.addView(search, searchParams);
    search.addTextChangedListener(new android.text.TextWatcher() {
      public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
      public void onTextChanged(CharSequence s, int start, int before, int count) { query = s.toString(); handler.removeCallbacks(searchRender); handler.postDelayed(searchRender, 180); }
      public void afterTextChanged(android.text.Editable s) {}
    });

    LinearLayout nav = row();
    if (Library.section(mode) != null && !libraryShown(custom)) mode = "Inicio";
    List<String> menu = new ArrayList<>(Arrays.asList("Inicio", "TV"));
    if (libraryShown(custom)) for (String[] section : Library.SECTIONS) menu.add(section[1]);
    menu.add("Favoritos");
    for (final String m : menu) {
      nav.addView(
          tab(
              m,
              mode.equals(m),
              new View.OnClickListener() {
                public void onClick(View v) {
                  if ((Library.section(m) != null) != (Library.section(mode) != null)) query = "";
                  mode = m;
                  home();
                }
              }));
    }
    HorizontalScrollView n = new HorizontalScrollView(this);
    n.setHorizontalScrollBarEnabled(false);
    n.addView(nav);
    root.addView(n);
    filters = row();
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    h.addView(filters);
    root.addView(h);
    message = label("", 11, Ui.FAINT);
    message.setPadding(0, dp(4), 0, dp(2));
    root.addView(message);
    ScrollView scroll = new ScrollView(this);
    catalogScroll = scroll;
    scroll.getViewTreeObserver().addOnScrollChangedListener(this::updateLazySections);
    scroll.getViewTreeObserver().addOnGlobalLayoutListener(this::updateLazySections);
    scroll.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> updateLazySections());
    scroll.setClipToPadding(false);
    list = new LinearLayout(this);
    list.setOrientation(LinearLayout.VERTICAL);
    list.setPadding(0, 0, 0, dp(28));
    scroll.addView(list);
    root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    renderFilters();
    render();
  }

  /** A section tab: bold capitals, with a lime bar under the one that is open. */
  View tab(String label, boolean active, View.OnClickListener l) {
    LinearLayout t = new LinearLayout(this);
    t.setOrientation(LinearLayout.VERTICAL);
    t.setFocusable(true);
    t.setClickable(true);
    // The outline is for the remote of a television (focus); on a touch screen the tab just changes, without
    // an outline while it is pressed.
    if (television) t.setBackground(Ui.focusFill(this, Color.TRANSPARENT, 0x1fffffff, Ui.ACC, 8, 0));
    else {
      StateListDrawable focusOnly = new StateListDrawable();
      focusOnly.addState(new int[] {android.R.attr.state_focused}, Ui.shape(this, 0x1fffffff, 8, 2, Ui.ACC));
      focusOnly.addState(new int[] {}, new ColorDrawable(Color.TRANSPARENT));
      t.setBackground(focusOnly);
    }
    TextView tv = new TextView(this);
    tv.setText(label.toUpperCase(new Locale("es", "ES")));
    tv.setTextSize(13);
    tv.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    tv.setLetterSpacing(0.06f);
    tv.setTextColor(active ? Ui.FG : Ui.MUTED);
    tv.setPadding(dp(14), dp(12), dp(14), dp(9));
    t.addView(tv);
    View bar = new View(this);
    bar.setBackground(Ui.shape(this, active ? Ui.ACC : Color.TRANSPARENT, 2, 0, 0));
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, dp(3));
    bp.setMargins(dp(10), 0, dp(10), 0);
    t.addView(bar, bp);
    t.setOnClickListener(l);
    return t;
  }

  void renderFilters() {
    if (filters == null) return;
    filters.removeAllViews();
    if (!mode.equals("TV")) return;
    List<String> names = new ArrayList<>();
    names.add("Todos");
    names.addAll(Catalog.groups(channels, custom).keySet());
    for (final String g : names) {
      Button b = Ui.pill(this, g, g.equals(group) ? Ui.Kind.ACCENT : Ui.Kind.SURFACE, true);
      b.setOnClickListener(
          new View.OnClickListener() {
            public void onClick(View v) {
              group = g;
              renderFilters();
              render();
            }
          });
      b.setId(1000 + Math.abs(g.hashCode() % 90000));
      addButton(filters, b);
    }
  }

  /** Puts the league logo before the title of the heading just added. */
  void leagueLogo(String url) {
    LinearLayout r = (LinearLayout) list.getChildAt(list.getChildCount() - 1);
    ImageView logo = new ImageView(this);
    logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(30), dp(30));
    lp.setMargins(dp(4), 0, 0, 0);
    r.addView(logo, 1, lp);
    logo(logo, url);
  }

  void heading(String title, String sub) {
    LinearLayout r = row();
    View bar = new View(this);
    bar.setBackground(Ui.shape(this, Ui.ACC, 2, 0, 0));
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(dp(4), dp(20));
    bp.setMargins(dp(2), 0, dp(6), 0);
    r.addView(bar, bp);
    TextView t = text(title, wide() ? 22 : 20);
    t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    t.setPadding(dp(6), dp(7), dp(12), dp(7));
    r.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
    if (sub != null) r.addView(label(sub, 12, Ui.FAINT));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(0, dp(18), 0, dp(4));
    list.addView(r, p);
  }

  void render() {
    if (list == null) return;
    handler.removeCallbacks(heroAdvance); heroHost = null;
    handler.removeCallbacks(browseAdvance); browseTrack = null;
    lazySections.clear();
    list.removeAllViews();
    message.setText(status());
    if (Library.section(mode) != null) {
      libraryPage(Library.section(mode));
      return;
    }
    if (mode.equals(HALLOWEEN)) {
      halloweenPage();
      return;
    }
    if (mode.startsWith(LEAGUE)) {
      leaguePage(mode.substring(LEAGUE.length()));
      return;
    }
    if (mode.equals(LIVE)) {
      livePage();
      return;
    }
    if (mode.startsWith(PLATFORM)) {
      platformPage(mode.substring(PLATFORM.length()));
      return;
    }
    if (mode.equals("Favoritos")) {
      heading("Favoritos", "Mantén pulsado para quitar");
      List<Catalog.Channel> saved = new ArrayList<>();
      for (Catalog.Channel c : channels) if (favorites.contains(c.channelId) && matches(c.name)) saved.add(c);
      channelGrid(saved);
      if (saved.isEmpty()) list.addView(label("Mantén pulsado un canal para añadirlo a favoritos.", 15, Ui.MUTED));
      return;
    }
    if (!query.trim().isEmpty()) {
      heading("Resultados", null);
      List<Catalog.Channel> found = new ArrayList<>();
      for (Catalog.Channel c : Catalog.events(channels, custom)) if (matches(c.name)) found.add(c);
      for (Catalog.Channel c : channels) if (matches(c.name + " " + c.group + " " + c.region)) found.add(c);
      channelGrid(found);
      // Films, series and documentaries too, as on the web.
      List<Library.Item> titles = new ArrayList<>();
      if (libraryShown(custom)) {
        if (library == null) loadLibrary();
        else for (String[] section : Library.SECTIONS) for (Library.Item item : library.items(section[0]))
          if (titles.size() < 30 && matches(item.title + " " + android.text.TextUtils.join(" ", item.genres))) titles.add(item);
      }
      if (!titles.isEmpty()) posterRail("Películas, series y documentales", titles, wide() ? 140 : 108);
      if (found.isEmpty() && titles.isEmpty()) list.addView(label("Sin resultados", 15, Ui.MUTED));
      return;
    }
    if (channels.isEmpty()) {
      heading("Catálogo no disponible", null);
      list.addView(label("Pulsa Actualizar para volver a consultarlo.", 15, MUTED));
      return;
    }
    if (mode.equals("TV")) {
      grid();
    } else {
      List<Catalog.Channel> featured = new ArrayList<>(Catalog.highlights(channels, custom));
      // Films and series marked «En portada» in the admin page join the featured events and channels.
      if (libraryShown(custom)) {
        loadLibrary();
        if (library != null) for (Library.Item item : library.featured()) featured.add(libraryHero(item));
      }
      List<Catalog.Channel> events = Catalog.events(channels, custom);
      if (!featured.isEmpty()) hero(featured);
      // «Eventos En Directo»: today's events with something to play, the first row of all.
      List<Catalog.Channel> live = Catalog.liveEvents(events, System.currentTimeMillis());
      if (!live.isEmpty()) {
        heading(Catalog.LIVE_ROW + "  ›", live.size() == 1 ? "1 evento" : live.size() + " eventos");
        // Its heading opens every one of today's events, by competition.
        View liveHeading = list.getChildAt(list.getChildCount() - 1);
        liveHeading.setFocusable(true);
        liveHeading.setClickable(true);
        liveHeading.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 8, 0));
        liveHeading.setContentDescription("Todos los eventos en directo, por competición");
        liveHeading.setOnClickListener(v -> { mode = LIVE; query = ""; home(); });
        carousel(live, live.size());
      }
      // Films and episodes left half watched come right under the featured slider, then the weekly top.
      if (libraryShown(custom)) {
        continueRow();
        if (library != null) profileRows();
        if (library != null) {
          topRow(library.top("movies"), "películas");
          topRow(library.top("series"), "series");
          // «Especial Halloween» until 2 November: every horror title, with «Descubrir todo».
          if (Library.halloweenOn(System.currentTimeMillis())) halloweenRow();
        }
      }
      // Only events on the home page: one row per league, each in date order.
      // The same events stay in their league's row too, as copies of the same card.
      // Only this week's events in the league rows: a league whose next matches are in two weeks does not appear yet.
      for (Catalog.EventRow row : Catalog.eventRows(Catalog.thisWeekEvents(events, System.currentTimeMillis()), custom)) {
        heading(row.id.isEmpty() ? row.name : row.name + "  ›", row.events.size() == 1 ? "1 evento" : row.events.size() + " eventos");
        if (!row.logo.isEmpty()) leagueLogo(row.logo);
        if (!row.id.isEmpty()) leagueHeadingOpens(row.id, row.name);
        carousel(row.events, row.events.size());
      }
      if (events.isEmpty()) list.addView(label("Todavía no hay eventos. Abre TV para ver todos los canales.", 15, MUTED));
    }
    TextView note =
        label(
            "Canales TDT: emisiones oficiales recopiladas por TDTChannels"
                + " (github.com/LaQuay/TDTChannels). Algunas solo funcionan desde España.",
            11,
            0xff727b88);
    list.addView(note);
  }

  LinearLayout.LayoutParams heroParams() {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(wide() ? 340 : 300));
    p.setMargins(0, dp(12), 0, dp(4));
    return p;
  }

  /** The featured channel, large, with a row of the other featured ones to pick from. */
  void hero(List<Catalog.Channel> picks) {
    heroItems = picks; heroHost = new HeroSlider(); heroIndex = 0;
    list.addView(heroHost, heroParams()); showHero(0, false);
  }

  void showHero(int index, boolean user) {
    if (heroHost == null || heroItems.isEmpty()) return;
    boolean focused = heroHost.hasFocus();
    heroIndex = index; heroHost.removeAllViews();
    View next = heroView(heroItems, index); heroHost.addView(next, new FrameLayout.LayoutParams(-1, -1));
    if (!television) { next.setAlpha(0f); next.animate().alpha(1f).setDuration(350).start(); }
    if (focused || user) { View control = next.findViewWithTag("hero-watch"); if (control != null) control.requestFocus(); }
    restartHeroTimer();
  }

  void restartHeroTimer() {
    handler.removeCallbacks(heroAdvance);
    if (resumed && !television && heroItems.size() > 1) handler.postDelayed(heroAdvance, 5000);
  }

  /**
   * The featured carousel: it moves on its own every 5 seconds and can be swiped left or right, as on
   * the web. A horizontal drag is taken from the buttons underneath and kept from the page scroll; a
   * vertical one still scrolls the page.
   */
  final class HeroSlider extends FrameLayout {
    private final int slop = ViewConfiguration.get(MainActivity.this).getScaledTouchSlop();
    private float downX, downY;
    private boolean dragging;

    HeroSlider() { super(MainActivity.this); }

    private boolean horizontal(MotionEvent e) {
      float dx = Math.abs(e.getX() - downX), dy = Math.abs(e.getY() - downY);
      return dx > slop && dx > dy * 1.5f;
    }

    private void start(MotionEvent e) {
      downX = e.getX(); downY = e.getY(); dragging = false;
      handler.removeCallbacks(heroAdvance);
    }

    private void settle() {
      dragging = false;
      if (getChildCount() > 0) getChildAt(0).animate().translationX(0).setDuration(150).start();
      restartHeroTimer();
    }

    @Override public boolean onInterceptTouchEvent(MotionEvent e) {
      if (heroItems.size() < 2) return false;
      switch (e.getActionMasked()) {
        case MotionEvent.ACTION_DOWN: start(e); return false;
        case MotionEvent.ACTION_MOVE:
          if (!dragging && horizontal(e)) { dragging = true; getParent().requestDisallowInterceptTouchEvent(true); }
          return dragging;
        case MotionEvent.ACTION_UP: case MotionEvent.ACTION_CANCEL:
          if (!dragging) restartHeroTimer();
          return false;
        default: return false;
      }
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
      if (heroItems.size() < 2) return super.onTouchEvent(e);
      switch (e.getActionMasked()) {
        case MotionEvent.ACTION_DOWN: start(e); return true;
        case MotionEvent.ACTION_MOVE:
          if (!dragging && horizontal(e)) { dragging = true; getParent().requestDisallowInterceptTouchEvent(true); }
          if (dragging && getChildCount() > 0) getChildAt(0).setTranslationX((e.getX() - downX) * 0.6f);
          return true;
        case MotionEvent.ACTION_UP:
          float dx = e.getX() - downX;
          if (dragging && Math.abs(dx) > dp(48)) {
            dragging = false;
            int n = heroItems.size();
            showHero(((heroIndex + (dx < 0 ? 1 : -1)) % n + n) % n, false);
          } else settle();
          return true;
        case MotionEvent.ACTION_CANCEL: settle(); return true;
        default: return true;
      }
    }
  }

  View heroView(final List<Catalog.Channel> picks, final int index) {
    final Catalog.Channel c = picks.get(index);
    final FrameLayout frame = new FrameLayout(this);
    frame.setBackground(Ui.heroBackground(this, Palette.hue(c.name)));
    frame.setClipToOutline(true);
    favoriteAction(frame, c);

    if (c.event) frame.addView(eventArt(c, wide() ? 0.42f : 0), new FrameLayout.LayoutParams(-1, -1));
    int size = wide() ? 250 : 150;
    Ui.LogoView logo = new Ui.LogoView(this, c.name, 20);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(size), dp(size));
    lp.gravity = wide() ? (Gravity.END | Gravity.CENTER_VERTICAL) : (Gravity.END | Gravity.TOP);
    lp.setMargins(0, wide() ? 0 : dp(18), dp(wide() ? 48 : 18), 0);
    frame.addView(logo, lp);
    logo(logo, c.logo);
    if (c.event) logo.setVisibility(View.GONE);

    View scrim = new View(this);
    scrim.setBackground(
        new GradientDrawable(
            wide() ? GradientDrawable.Orientation.LEFT_RIGHT : GradientDrawable.Orientation.BOTTOM_TOP,
            new int[] {0xf00b0d10, 0x8c0b0d10, 0x000b0d10}));
    frame.addView(scrim, new FrameLayout.LayoutParams(-1, -1));

    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.BOTTOM);
    content.setPadding(dp(20), dp(20), dp(20), dp(20));
    if (c.event && !isLibraryHero(c)) content.addView(eventBadge(c, 11), new LinearLayout.LayoutParams(-2, -2));
    if (isLibraryHero(c)) content.addView(Ui.tag(this, c.meta.split(" · ")[0], 11), new LinearLayout.LayoutParams(-2, -2));
    TextView title = new TextView(this);
    title.setText(c.name);
    title.setTextColor(Ui.FG);
    title.setTextSize(wide() ? 38 : 28);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setLetterSpacing(-0.02f);
    title.setMaxLines(2);
    title.setPadding(0, dp(8), 0, 0);
    content.addView(title);
    TextView meta = new TextView(this);
    StringBuilder line = new StringBuilder(c.event ? c.meta : c.group);
    if (!c.region.isEmpty() && !isLibraryHero(c)) line.append(" · ").append(c.region);
    if (!c.event) line.append(" · ").append(c.own ? "Canal de Calamar TV" : "Emisión oficial en abierto");
    meta.setText(line);
    meta.setTextColor(0xffd6dbe2);
    meta.setTextSize(14);
    meta.setPadding(0, dp(4), 0, dp(14));
    content.addView(meta);
    LinearLayout actions = row();
    Button watch = Ui.pill(this, "Ver ahora", Ui.Kind.ACCENT, false);
    watch.setCompoundDrawablesWithIntrinsicBounds(Ui.icon(Ui.Icon.PLAY, Ui.BG, dp(18)), null, null, null);
    watch.setCompoundDrawablePadding(dp(8));
    watch.setTag("hero-watch");
    favoriteAction(watch, c);
    watch.setOnClickListener(
        new View.OnClickListener() {
          public void onClick(View v) {
            open(c);
          }
        });
    LinearLayout.LayoutParams wp = new LinearLayout.LayoutParams(-2, dp(48));
    wp.setMargins(0, 0, dp(10), 0);
    actions.addView(watch, wp);
    if (isLibraryHero(c)) {
      // A film plays from «Ver ahora»; its page (and a series' episodes) from here.
      if (c.region.equals("film")) {
        Button info = Ui.pill(this, "Más información", Ui.Kind.SURFACE, false);
        info.setOnClickListener(v -> openLibraryHero(c, true));
        actions.addView(info, new LinearLayout.LayoutParams(-2, dp(48)));
      } else watch.setText("Ver episodios");
    }
    content.addView(actions);
    frame.addView(content, new FrameLayout.LayoutParams(-1, -1));

    if (picks.size() > 1 && !wide()) {
      // Phones have no room for the thumbnails: dots show which highlight is on screen.
      LinearLayout dots = new LinearLayout(this);
      dots.setGravity(Gravity.CENTER);
      for (int i = 0; i < picks.size(); i++) {
        View dot = new View(this);
        dot.setBackground(Ui.shape(this, i == index ? Ui.ACC : 0x73ffffff, 4, 0, 0));
        LinearLayout.LayoutParams dotSize = new LinearLayout.LayoutParams(dp(i == index ? 22 : 8), dp(8));
        dotSize.setMargins(dp(3), 0, dp(3), 0);
        dots.addView(dot, dotSize);
      }
      dots.setContentDescription("Destacado " + (index + 1) + " de " + picks.size() + ". Desliza para ver otro.");
      FrameLayout.LayoutParams dl = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
      dl.setMargins(0, 0, 0, dp(8));
      frame.addView(dots, dl);
    }
    if (picks.size() > 1 && wide()) {
      LinearLayout row = row();
      for (int i = 0; i < picks.size(); i++) {
        final int pick = i;
        FrameLayout thumb = new FrameLayout(this);
        thumb.setTag("pick" + i);
        thumb.setFocusable(true);
        thumb.setClickable(true);
        thumb.setContentDescription(picks.get(i).name);
        thumb.setBackground(
            Ui.focusFill(
                this,
                0x1affffff,
                0x33ffffff,
                Ui.ACC,
                10,
                i == index ? Ui.ACC : 0));
        thumb.setAlpha(i == index ? 1f : 0.75f);
        Ui.LogoView small = new Ui.LogoView(this, picks.get(i).name, 6);
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(dp(30), dp(30), Gravity.CENTER);
        thumb.addView(small, sp);
        image(small, picks.get(i).logo);
        favoriteAction(thumb, picks.get(i));
        thumb.setOnClickListener(
            new View.OnClickListener() {
              public void onClick(View v) {
                showHero(pick, true);
              }
            });
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(dp(68), dp(44));
        tp.setMargins(dp(4), 0, dp(4), 0);
        row.addView(thumb, tp);
      }
      FrameLayout.LayoutParams rp =
          new FrameLayout.LayoutParams(-2, -2, Gravity.END | Gravity.BOTTOM);
      rp.setMargins(0, 0, dp(40), dp(18));
      HorizontalScrollView pickScroll = new HorizontalScrollView(this);
      pickScroll.setHorizontalScrollBarEnabled(false); pickScroll.addView(row);
      rp.width = dp(360); frame.addView(pickScroll, rp);
    }
    return frame;
  }

  /** Until an event starts it shows its date and time; then the live pill. */
  static class AudienceTag {final String target;AudienceTag(String target){this.target=target;}}
  final Map<String,Long> cardViewers=new HashMap<>();boolean cardAudienceReady,cardAudienceBusy;
  final Runnable audienceRefresh=new Runnable(){public void run(){
    if(!resumed)return;
    // One count per card shown (one read each, the first ones only), never every presence document:
    // reading them all from every phone used up the free Firestore quota during a big match.
    LinkedHashSet<String> targets=new LinkedHashSet<>();collectAudienceTargets(root,targets);collectAudienceTargets(multiPicker,targets);
    if(!cardAudienceBusy&&!targets.isEmpty()){
      cardAudienceBusy=true;
      com.google.firebase.firestore.FirebaseFirestore db=com.google.firebase.firestore.FirebaseFirestore.getInstance(SharedCatalog.app(MainActivity.this));
      List<String> asked=new ArrayList<>(targets);if(asked.size()>AudienceModel.CARD_TARGETS)asked=asked.subList(0,AudienceModel.CARD_TARGETS);
      List<com.google.android.gms.tasks.Task<com.google.firebase.firestore.AggregateQuerySnapshot>> tasks=new ArrayList<>();
      for(String target:asked)tasks.add(db.collection("calamarAudience").whereIn("beat",AudienceModel.beats(target,System.currentTimeMillis())).count().get(com.google.firebase.firestore.AggregateSource.SERVER));
      final List<String> names=asked;
      com.google.android.gms.tasks.Tasks.whenAllComplete(tasks).addOnCompleteListener(done -> {
        cardAudienceBusy=false;if(!resumed)return;cardViewers.clear();boolean ok=true;
        for(int i=0;i<tasks.size();i++){if(tasks.get(i).isSuccessful())cardViewers.put(names.get(i),tasks.get(i).getResult().getCount());else ok=false;}
        cardAudienceReady=ok||!cardViewers.isEmpty();
        paintCardViewers(root);paintCardViewers(multiPicker);
      });
    }
    handler.removeCallbacks(this);handler.postDelayed(this,AudienceModel.CARDS_MS);
  }};
  void collectAudienceTargets(View view,Set<String> out){
    if(view==null)return;
    if(view.getTag() instanceof AudienceTag&&((AudienceTag)view.getTag()).target!=null)out.add(((AudienceTag)view.getTag()).target);
    if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)collectAudienceTargets(group.getChildAt(i),out);}
  }
  void paintCardViewers(View view){
    if(view==null)return;
    if(view instanceof TextView&&view.getTag() instanceof AudienceTag){String target=((AudienceTag)view.getTag()).target;Long value=cardViewers.get(target);
      // Only the first cards are counted; the others show no number rather than a wrong 0.
      view.setVisibility(cardAudienceReady&&value==null?View.GONE:View.VISIBLE);
      String count=cardAudienceReady?String.valueOf(value==null?0:value):"—";((TextView)view).setText(count);view.setContentDescription(count.equals("—")?"Espectadores no disponibles":count+" personas viendo");}
    if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)paintCardViewers(group.getChildAt(i));}
  }
  final Map<String,MatchScores.Result> matchResults=new HashMap<>();
  boolean scoresBusy;
  View multiPicker;
  final Runnable scoreRefresh=new Runnable(){public void run(){
    if(!resumed)return;
    if(!scoresBusy){
      Set<String> ids=new HashSet<>(); Map<String,String> starts=new HashMap<>(); for(Catalog.Channel e:Catalog.events(channels,custom))if(!e.matchUrl.isEmpty()&&!e.matchId.isEmpty()&&MatchScores.shouldPoll(e.matchId,System.currentTimeMillis())){ids.add(e.matchId);starts.put(e.matchId,e.startAt);} collectScoreIds(root,ids); collectScoreIds(multiPicker,ids);
      for(String id:ids)if(!starts.containsKey(id))starts.put(id,"");
      if(!ids.isEmpty()) { scoresBusy=true; new Thread(() -> {
        // One ESPN scoreboard per day for every card, not one whole summary per match.
        Map<String,MatchScores.Result> results=MatchScores.fetchAll(starts);
        runOnUiThread(() -> {scoresBusy=false;matchResults.putAll(results);if(resumed){updateScores(root);updateScores(multiPicker);pruneFinishedEvents();} });
      }).start(); }
    }
    handler.removeCallbacks(this);handler.postDelayed(this,30000);
  }};
  String expiredSignature="";
  Runnable redrawMulti;
  final Runnable expiryCheck=() -> pruneFinishedEvents();
  void pruneFinishedEvents(){
    handler.removeCallbacks(expiryCheck); long now=System.currentTimeMillis(),next=Long.MAX_VALUE;
    List<String> expired=new ArrayList<>();
    for(JSONObject e:Competitions.all(custom)){if(e.optString("matchUrl").isEmpty())continue;String id=e.optString("matchId");long end=MatchScores.deadline(id);if(MatchScores.expired(id,now))expired.add(id);else if(end>now)next=Math.min(next,end);}
    Collections.sort(expired);String signature=expired.toString();
    if(!signature.equals(expiredSignature)){expiredSignature=signature;render();if(redrawMulti!=null)redrawMulti.run();}
    if(resumed&&next!=Long.MAX_VALUE)handler.postDelayed(expiryCheck,Math.max(1,next-now+1));
  }
  void collectScoreIds(View view,Set<String> ids){
    if(view==null)return;
    if(view instanceof TextView && view.getTag() instanceof Catalog.Channel){Catalog.Channel c=(Catalog.Channel)view.getTag();if(!c.matchId.isEmpty())ids.add(c.matchId);}
    if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)collectScoreIds(group.getChildAt(i),ids);}
  }
  void updateScores(View view){
    if(view==null)return;
    if(view instanceof TextView && view.getTag() instanceof Catalog.Channel){Catalog.Channel c=(Catalog.Channel)view.getTag();MatchScores.Result score=matchResults.get(c.matchId);((TextView)view).setText(score==null?"Marcador no disponible":scoreLabel(c,score));view.setContentDescription(((TextView)view).getText()+". Resultados: ESPN");}
    if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)updateScores(group.getChildAt(i));}
  }
  String scoreLabel(Catalog.Channel c,MatchScores.Result score){return "scheduled".equals(score.state) && SportsCatalog.instant(c.startAt)>System.currentTimeMillis()?SportsCatalog.label("scheduled",c.startAt,System.currentTimeMillis()):score.text;}
  TextView eventBadge(Catalog.Channel c, float sp) {
    MatchScores.Result score=matchResults.get(c.matchId);
    String label=c.matchUrl.isEmpty()?SportsCatalog.label(c.status,c.startAt,System.currentTimeMillis()):score==null?"Consultando marcador…":scoreLabel(c,score);
    TextView badge=SportsCatalog.LIVE.equals(label)?Ui.livePill(this,label.toUpperCase(Locale.ROOT),sp):Ui.tag(this,label,sp);
    if(!c.matchUrl.isEmpty()&&!c.matchId.isEmpty()){badge.setTag(c);badge.setContentDescription(label+". Resultados: ESPN");handler.removeCallbacks(scoreRefresh);handler.postDelayed(scoreRefresh,300);}
    return badge;
  }

  /**
   * Registered teams' crests stay on top of a manual or imported match's artwork. Events without
   * crests keep their full photo. `shift` moves the crests right, past the hero's text.
   */
  View eventArt(Catalog.Channel c, float shift) {
    FrameLayout art = new FrameLayout(this);
    ImageView cover = new ImageView(this);
    cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
    art.addView(cover, new FrameLayout.LayoutParams(-1, -1));
    if (!c.cover.isEmpty() && c.homeLogo.isEmpty() && c.awayLogo.isEmpty()) { image(cover, c.cover); return art; }
    art.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0xff10261a, 0xff1d4029, 0xff0b1410}));
    image(cover, c.cover.isEmpty() ? c.background : c.cover);
    // Each crest gets 30% of the width and keeps its shape (FIT_CENTER), whatever the card's size.
    LinearLayout crests = new LinearLayout(this);
    crests.setGravity(Gravity.CENTER);
    crests.setPadding(0, dp(10), 0, dp(10));
    art.addView(crests, new FrameLayout.LayoutParams(-1, -1));
    crests.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1 + shift * 10));
    for (String logo : new String[] {c.homeLogo, c.awayLogo}) {
      if (crests.getChildCount() > 1 && !c.leagueLogo.isEmpty()) {
        // The league's logo between the crests, on a dark rounded square.
        FrameLayout slot = new FrameLayout(this);
        FrameLayout tile = new FrameLayout(this) {
          @Override protected void onMeasure(int w, int h) {
            int side = Math.min(MeasureSpec.getSize(w), Math.round(MeasureSpec.getSize(h) * 0.62f));
            int spec = MeasureSpec.makeMeasureSpec(side, MeasureSpec.EXACTLY);
            super.onMeasure(spec, spec);
          }
        };
        GradientDrawable box = new GradientDrawable(); box.setColor(0xff0b1240); box.setCornerRadius(dp(shift > 0 ? 14 : 8));
        tile.setBackground(box);
        tile.setPadding(dp(4), dp(4), dp(4), dp(4));
        ImageView league = new ImageView(this);
        league.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo(league, c.leagueLogo);
        tile.addView(league, new FrameLayout.LayoutParams(-1, -1));
        slot.addView(tile, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        crests.addView(slot, new LinearLayout.LayoutParams(0, -1, 1.7f));
      } else if (crests.getChildCount() > 1) {
        TextView vs = new TextView(this);
        vs.setText("VS"); vs.setTextColor(Ui.FG); vs.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        vs.setTextSize(shift > 0 ? 20 : 12);
        vs.setShadowLayer(dp(4), 0, dp(1), 0xcc000000);
        vs.setPadding(dp(6), 0, dp(6), 0);
        crests.addView(vs, new LinearLayout.LayoutParams(-2, -2));
      }
      ImageView crest = new ImageView(this);
      crest.setScaleType(ImageView.ScaleType.FIT_CENTER);
      if (logo.isEmpty()) { GradientDrawable dot = new GradientDrawable(); dot.setShape(GradientDrawable.OVAL); dot.setColor(0x24ffffff); crest.setImageDrawable(dot); }
      else logo(crest, logo);
      crests.addView(crest, new LinearLayout.LayoutParams(0, -1, 3));
    }
    crests.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1));
    return art;
  }

  /** A 16:9 card: colour from the name, logo, live badge, then the name and its category. */
  View card(final Catalog.Channel c, int width) {
    LinearLayout card = new LinearLayout(this);
    card.setId(100000 + Math.abs(c.id.hashCode() % 800000));
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(dp(3), dp(3), dp(3), dp(8));
    card.setFocusable(true);
    card.setClickable(true);
    Ui.scaleOnFocus(card, 1.03f);

    FrameLayout art = new FrameLayout(this);
    art.setBackground(c.event ? Ui.artBackground(this, Palette.hue(c.name), 12) : Ui.categoryBackground(this, c.color, 12));
    art.setDuplicateParentStateEnabled(true);
    int artHeight = Math.round(dp(width) * 9f / 16f);
    if (c.event) {
      art.addView(eventArt(c, 0), new FrameLayout.LayoutParams(-1, -1));
      // The cover covers the background's border, so the focus border goes on top, as on channels.
      art.setForeground(Ui.focusOutline(this, 12));
      art.setClipToOutline(true);
    }
    // The logo fills the card as much as it can, with a small margin from the rounded corners.
    Ui.LogoView logo = new Ui.LogoView(this, c.name, 8);
    FrameLayout.LayoutParams logoSize = new FrameLayout.LayoutParams(-1, -1);
    logoSize.setMargins(dp(6), dp(6), dp(6), dp(6));
    art.addView(logo, logoSize);
    logo(logo, c.logo);
    if (c.event) logo.setVisibility(View.GONE);
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
    bp.setMargins(dp(8), dp(8), 0, 0);
    if (c.event) {TextView badge=eventBadge(c,9);badge.setMaxWidth(dp(Math.max(60,width-88)));art.addView(badge,bp);}
    TextView viewers=Ui.audienceBadge(this,10);viewers.setTag(new AudienceTag(AudienceModel.target(c.event,c.id)));paintCardViewers(viewers);
    FrameLayout.LayoutParams vp=new FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.END);vp.setMargins(0,dp(8),dp(8),0);art.addView(viewers,vp);
    card.addView(art, new LinearLayout.LayoutParams(-1, artHeight));

    TextView name = text((favorites.contains(c.channelId) ? "★ " : "") + c.name, 15);
    name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    wholeName(name);
    name.setPadding(dp(2), dp(8), dp(2), 0);
    card.addView(name, new LinearLayout.LayoutParams(-1, 0, 1));
    TextView sub = label(AppSources.forAndroid(c.streams).isEmpty() && c.playable() ? "Disponible en la web" : c.event ? c.meta : c.region.isEmpty() ? c.group : c.region, 12, Ui.MUTED);
    sub.setSingleLine(!c.event);
    if (c.event) { sub.setMaxLines(2); sub.setMinLines(2); }
    sub.setEllipsize(android.text.TextUtils.TruncateAt.END);
    sub.setPadding(dp(2), 0, dp(2), 0);
    card.addView(sub);
    card.setContentDescription(c.name + ". Mantén pulsado para añadir o quitar de favoritos");
    favoriteAction(card, c);
    card.setOnClickListener(
        new View.OnClickListener() {
          public void onClick(View v) {
            open(c);
          }
        });
    // As tall as the tallest card of its row, so the line under every name sits at the same height.
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -1);
    p.setMargins(dp(4), dp(4), dp(6), dp(6));
    card.setLayoutParams(p);
    return card;
  }

  final class LazySection extends FrameLayout {
    final java.util.concurrent.Callable<View> factory;
    int rememberedHeight;
    LazySection(int height, java.util.concurrent.Callable<View> factory) {
      super(MainActivity.this);
      this.factory = factory;
      rememberedHeight = height;
      setMinimumHeight(height);
      setFocusable(true);
      setContentDescription("Más canales");
      setOnFocusChangeListener((v, focused) -> {
        if (focused) { populate(); if (getChildCount() > 0) getChildAt(0).requestFocus(View.FOCUS_DOWN); }
      });
    }
    void populate() {
      if (getChildCount() != 0) return;
      try {
        boolean focused = hasFocus();
        View content = factory.call();
        addView(content, new FrameLayout.LayoutParams(-1, -2));
        setFocusable(false);
        if (focused) content.requestFocus(View.FOCUS_DOWN);
      } catch (Exception error) { throw new IllegalStateException(error); }
    }
    void update(int top, int bottom) {
      int y = getTop(), height = Math.max(getHeight(), rememberedHeight);
      if (y + height >= top && y <= bottom) populate();
      else if (getChildCount() > 0 && !hasFocus()) {
        rememberedHeight = height;
        setMinimumHeight(height);
        removeAllViews();
        setFocusable(true);
      }
    }
  }

  void lazyRow(int height, java.util.concurrent.Callable<View> factory) {
    LazySection section = new LazySection(dp(height), factory);
    lazySections.add(section);
    list.addView(section, new LinearLayout.LayoutParams(-1, -2));
    handler.removeCallbacks(lazyUpdate);
    handler.post(lazyUpdate);
  }

  void updateLazySections() {
    if (!television || catalogScroll == null || !resumed || isDestroyed()) return;
    int margin = catalogScroll.getHeight();
    if (margin <= 0 || list.isLayoutRequested()) return;
    int top = catalogScroll.getScrollY() - margin;
    int bottom = top + margin * 3;
    for (LazySection section : lazySections) section.update(top, bottom);
  }

  void carousel(List<Catalog.Channel> a, int limit) {
    if (television) {
      // Groups remain complete. Their cards are created only as the row approaches the screen.
      lazyRow(220, () -> channelCarousel(a, limit));
    } else list.addView(channelCarousel(a, limit));
  }

  View channelCarousel(List<Catalog.Channel> a, int limit) {
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    h.setClipToPadding(false);
    LinearLayout r = row();
    r.setGravity(Gravity.TOP);
    for (int i = 0; i < Math.min(a.size(), limit); i++) r.addView(card(a.get(i), wide() ? 230 : 172));
    h.addView(r);
    return h;
  }

  int gridWidth(int columns) {
    return (getResources().getConfiguration().screenWidthDp - 2 * gutter()) / columns - 10;
  }

  void grid() {
    int columns = wide() ? 4 : 2;
    int width = gridWidth(columns);
    for (Map.Entry<String, List<Catalog.Channel>> e : Catalog.groups(channels, custom).entrySet()) {
      if (!group.equals("Todos") && !group.equals(e.getKey())) continue;
      heading(e.getKey(), e.getValue().size() + " canales");
      if (television) { channelGrid(regionSorted(e.getValue())); continue; }
      String region = null;
      LinearLayout r = null;
      int i = 0;
      for (Catalog.Channel c : regionSorted(e.getValue())) {
        if (!c.region.isEmpty() && !c.region.equals(region)) {
          region = c.region;
          TextView regionLabel =
              label(region.toUpperCase(new Locale("es", "ES")), 12, Ui.ACC);
          regionLabel.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
          regionLabel.setLetterSpacing(0.1f);
          regionLabel.setPadding(dp(4), dp(16), 0, dp(4));
          list.addView(regionLabel);
          i = 0;
        }
        if (i++ % columns == 0) {
          r = row();
          r.setGravity(Gravity.TOP);
          list.addView(r);
        }
        r.addView(card(c, width));
      }
    }
  }

  List<Catalog.Channel> regionSorted(List<Catalog.Channel> in) {
    List<Catalog.Channel> out = new ArrayList<>(in);
    Collections.sort(
        out,
        new Comparator<Catalog.Channel>() {
          public int compare(Catalog.Channel a, Catalog.Channel b) {
            int r = a.region.compareTo(b.region);
            return r != 0 ? r : Boolean.compare(b.playable(), a.playable());
          }
        });
    return out;
  }

  /** Multi-screen: pick 2 to 6 channels or events (events first) and watch them together. */
  void pickMulti() {
    final List<Catalog.Channel> options = new ArrayList<>();
    for (Catalog.Channel c : Catalog.events(channels, custom)) if (directMedia(c)) options.add(c);
    for (Catalog.Channel c : channels) if (directMedia(c)) options.add(c);
    if (options.size() < 2) {
      Toast.makeText(this, "No hay suficientes canales para la multipantalla", Toast.LENGTH_LONG).show();
      return;
    }
    final List<Catalog.Channel> selected=new ArrayList<>();
    LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setPadding(dp(16),dp(8),dp(16),dp(8));
    panel.addView(text("Multipantalla",22));
    EditText search=new EditText(this);search.setSingleLine(true);search.setHint("Buscar eventos o canales");search.setTextColor(Ui.FG);search.setHintTextColor(Ui.MUTED);panel.addView(search,new LinearLayout.LayoutParams(-1,-2));
    TextView count=text("Elige de 2 a "+MultiScreen.MAX,14);panel.addView(count);
    ScrollView scroll=new ScrollView(this);LinearLayout grid=new LinearLayout(this);grid.setOrientation(LinearLayout.VERTICAL);scroll.addView(grid);panel.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    Button watch=new Button(this);watch.setText("Ver a la vez");watch.setAllCaps(false);watch.setEnabled(false);
    Button cancel=new Button(this);cancel.setText("Cancelar");cancel.setAllCaps(false);
    LinearLayout actions=new LinearLayout(this);actions.addView(cancel,new LinearLayout.LayoutParams(0,-2,1));actions.addView(watch,new LinearLayout.LayoutParams(0,-2,1));panel.addView(actions);
    Dialog dialog=new Dialog(this,android.R.style.Theme_Material_NoActionBar);dialog.setContentView(panel,new ViewGroup.LayoutParams(-1,-1));
    cancel.setOnClickListener(v -> dialog.dismiss());
    final Map<Catalog.Channel,TextView> marks=new HashMap<>();
    Runnable sync=() -> {count.setText(selected.size()+" / "+MultiScreen.MAX+" seleccionados");watch.setText("Ver "+selected.size()+" a la vez");watch.setEnabled(selected.size()>=2);
      for(Map.Entry<Catalog.Channel,TextView> mark:marks.entrySet()){int index=selected.indexOf(mark.getKey());mark.getValue().setText(index<0?"+":String.valueOf(index+1));View tile=(View)mark.getValue().getParent();tile.setSelected(index>=0);tile.setContentDescription(mark.getKey().name+(index<0?", añadir":", seleccionado "+(index+1)));}
    };
    Runnable draw=() -> {
      selected.removeIf(c -> c.event && MatchScores.expired(c.matchId,System.currentTimeMillis()));
      grid.removeAllViews();marks.clear();String q=search.getText().toString().trim().toLowerCase(Locale.ROOT);
      int available=(int)(getResources().getDisplayMetrics().widthPixels/getResources().getDisplayMetrics().density)-64;
      int columns=available>=800?4:available>=540?3:2,width=Math.max(100,available/columns-8),column=0;LinearLayout row=null;
      for(Catalog.Channel c:options){if(c.event&&MatchScores.expired(c.matchId,System.currentTimeMillis()))continue;if(!(c.name+" "+c.meta+" "+c.group).toLowerCase(Locale.ROOT).contains(q))continue;
        if(column++%columns==0){row=new LinearLayout(this);grid.addView(row,new LinearLayout.LayoutParams(-1,-2));}
        FrameLayout tile=new FrameLayout(this);View content=card(c,width);content.setOnClickListener(null);content.setOnLongClickListener(null);content.setFocusable(false);content.setClickable(false);content.setLongClickable(false);tile.addView(content,new FrameLayout.LayoutParams(-1,-2));
        TextView mark=Ui.tag(this,"+",16);FrameLayout.LayoutParams mp=new FrameLayout.LayoutParams(-2,-2,Gravity.BOTTOM|Gravity.END);mp.setMargins(0,0,dp(8),dp(8));tile.addView(mark,mp);marks.put(c,mark);
        tile.setBackground(Ui.artBackground(this,Palette.hue(c.name),12));tile.setFocusable(true);tile.setClickable(true);Ui.scaleOnFocus(tile,1.03f);
        tile.setOnClickListener(v -> {if(selected.contains(c))selected.remove(c);else if(selected.size()<MultiScreen.MAX)selected.add(c);else Toast.makeText(this,"Máximo "+MultiScreen.MAX+" a la vez",Toast.LENGTH_SHORT).show();sync.run();});
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(dp(width),-2);lp.setMargins(dp(4),dp(4),dp(4),dp(8));row.addView(tile,lp);
      }
      if(marks.isEmpty())grid.addView(text("Sin resultados",16));sync.run();
    };
    search.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){draw.run();}public void afterTextChanged(android.text.Editable e){}});
    watch.setOnClickListener(v -> {
      if(selected.size()<2)return;
      ArrayList<String> titles=new ArrayList<>(),streams=new ArrayList<>(),targets=new ArrayList<>(),channelIds=new ArrayList<>();for(Catalog.Channel c:selected){titles.add(c.name);streams.add(android.text.TextUtils.join("\n",AppSources.forAndroid(c.streams)));targets.add(AudienceModel.target(c.event,c.id));channelIds.add(c.event?c.channelId:c.id);}
      dialog.dismiss();startActivity(new Intent(this,MultiPlayerActivity.class).putStringArrayListExtra(MultiPlayerActivity.TITLES,titles).putStringArrayListExtra(MultiPlayerActivity.STREAMS,streams).putStringArrayListExtra("audience_targets",targets).putStringArrayListExtra("audience_channels",channelIds));
    });
    multiPicker=panel;redrawMulti=draw;dialog.setOnDismissListener(d -> {multiPicker=null;redrawMulti=null;});dialog.show();
    dialog.getWindow().setBackgroundDrawableResource(android.R.color.black);dialog.getWindow().setLayout(-1,-1);
    dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);draw.run();
  }

  /** Channels whose links are videos the player opens directly (not pages resolved in the full player). */
  boolean directMedia(Catalog.Channel c) {
    List<String> sources = AppSources.forAndroid(c.streams);
    return !sources.isEmpty() && !UserChannels.isPage(sources.get(0));
  }

  void open(Catalog.Channel c) {
    if (isLibraryHero(c)) { openLibraryHero(c, false); return; }
    if(c.event&&MatchScores.expired(c.matchId,System.currentTimeMillis())){Toast.makeText(this,"El evento ha finalizado",Toast.LENGTH_SHORT).show();return;}
    if (c.pending) {
      // An imported match without a channel yet: its match page alone, with no video.
      Intent match = new Intent(this, MatchActivity.class);
      match.putExtra("title", c.name).putExtra("match_id", c.matchId).putExtra("event_info", eventInfo(c).toString());
      startActivity(match);
      return;
    }
    if (!c.playable()) {
      try {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(c.web)));
      } catch (android.content.ActivityNotFoundException missing) {
        Toast.makeText(this, "No hay navegador instalado", Toast.LENGTH_LONG).show();
      }
      return;
    }
    ArrayList<String> playableSources = AppSources.forAndroid(c.streams);
    if (playableSources.isEmpty()) {
      Toast.makeText(this, "Este canal solo tiene fuentes disponibles en la web", Toast.LENGTH_LONG).show();
      return;
    }
    Intent intent = new Intent(this, NativePlayerActivity.class);
    String first = playableSources.get(0);
    if (UserChannels.isPage(first)) intent.putExtra("page_url", first);
    else intent.putStringArrayListExtra("media_urls", playableSources);
    intent.putExtra("title", c.name);
    // Every link of the channel: when one source fails the player moves on to the next.
    intent.putStringArrayListExtra("channel_streams", playableSources);
    intent.putExtra("audience_target",AudienceModel.target(c.event,c.id));intent.putExtra("audience_channel",c.event?c.channelId:c.id);
    if(c.event && !c.matchId.isEmpty())intent.putExtra("match_id",c.matchId);
    // Events open with the match under the video on phones; without a match link, with the event's own data.
    if(c.event)intent.putExtra("event_info",eventInfo(c).toString());
    // Events and channels are shared from the player with their preview link (their card in WhatsApp).
    if (c.event) intent.putExtra("share_url", SportsCatalog.link(SportsCatalog.slugs(custom).get(c.id)));
    else { String slug = Catalog.slugs(channels).get(c.id); if (slug != null) intent.putExtra("share_url", SportsCatalog.WEB + "canal/" + slug + "/"); }
    startActivity(intent);
  }

  /** The event's teams, league, date, place and description, for the match page under the video. */
  JSONObject eventInfo(Catalog.Channel c) {
    JSONObject info = new JSONObject();
    JSONObject e = Competitions.find(custom, c.id);
    if (e == null) e = new JSONObject();
    try {
      JSONObject home = SportsCatalog.find(custom.optJSONArray("teams"), e.optString("homeTeamId")),
          away = SportsCatalog.find(custom.optJSONArray("teams"), e.optString("awayTeamId")),
          league = SportsCatalog.find(custom.optJSONArray("leagues"), e.optString("leagueId"));
      String[] names = c.name.split("\\s+(?i:vs\\.?|v|contra|-|–)\\s+", 2);
      info.put("home", home != null ? home.optString("name") : names[0]).put("homeLogo", home != null ? home.optString("logo") : "")
          .put("away", away != null ? away.optString("name") : names.length > 1 ? names[1] : "").put("awayLogo", away != null ? away.optString("logo") : "")
          .put("league", league != null ? league.optString("name") : "").put("startAt", e.optString("startAt"))
          .put("round", e.optString("round")).put("venue", e.optString("venue")).put("description", e.optString("description"))
          .put("status", SportsCatalog.label(c.status, c.startAt, System.currentTimeMillis()));
    } catch (JSONException ignored) {
    }
    return info;
  }

  protected void onPause() {
    super.onPause();
    if (trailerPreview != null) { trailerPreview.evaluateJavascript("window.pauseTrailer && window.pauseTrailer()", null); trailerPreview.onPause(); }
    if (updater != null) updater.pause();
    sharedSession++;
    resumed = false; handler.removeCallbacks(heroAdvance); handler.removeCallbacks(browseAdvance); handler.removeCallbacks(scoreRefresh); handler.removeCallbacks(expiryCheck);handler.removeCallbacks(audienceRefresh);
    handler.removeCallbacks(refresh);
    handler.removeCallbacks(searchRender);
    if (sharedListener != null) {
      sharedListener.remove();
      sharedListener = null;
    }
  }

  protected void onResume() {
    super.onResume();
    if (trailerPreview != null) trailerPreview.onResume();
    if (updater != null) updater.resume();
    // «Elige tu perfil» still open (back from «Añadir» or «Modificar»): its titles go on changing.
    if (gate != null && gate.isShowing() && gateSlide != null) { handler.removeCallbacks(gateSlide); handler.postDelayed(gateSlide, 6000); }
    // Signing in or out as administrator (in Administración) shows or hides the library while it is hidden.
    boolean admin = libraryAdmin();
    if (admin != libraryAdminShown) { libraryAdminShown = admin; if (custom != null) render(); }
    resumed = true; handler.post(this::updateLazySections); handler.removeCallbacks(audienceRefresh);handler.post(audienceRefresh); pruneFinishedEvents(); handler.removeCallbacks(scoreRefresh); handler.post(scoreRefresh);
    if (!television && heroHost != null && heroItems.size() > 1) handler.postDelayed(heroAdvance, 5000);
    handler.removeCallbacks(refresh);
    handler.post(refresh);
    observeSharedCatalog();
    handler.post(this::openPendingAppLink);
    // «Continuar viendo» of the signed-in account: what its other devices left half watched.
    ProgressSync.sync(this, changed -> { if (changed && !isFinishing() && custom != null) render(); });
  }

  AppUpdater createUpdater() { return new AppUpdater(this, () -> UpdateInfo.offered(custom, SharedCatalog.administrator(Profiles.user(this)))); }

  void observeSharedCatalog() {
    final int session = ++sharedSession;
    sharedListener = SharedCatalog.document(this).addSnapshotListener(
        sharedWorker, com.google.firebase.firestore.MetadataChanges.INCLUDE,
        (snapshot, error) -> {
          if (error == null) acceptSharedSnapshot(snapshot, session);
        });
  }

  /** Explicit server read on opening/refresh; the disk copy is only the offline starting point. */
  void refreshSharedCatalog() {
    if (sharedRefreshBusy || !resumed || isDestroyed()) return;
    sharedRefreshBusy = true;
    final int session = sharedSession;
    SharedCatalog.document(this).get(com.google.firebase.firestore.Source.SERVER)
        .addOnCompleteListener(sharedWorker, result -> {
          if (result.isSuccessful()) acceptSharedSnapshot(result.getResult(), session);
          runOnUiThread(() -> sharedRefreshBusy = false);
        });
  }

  void acceptSharedSnapshot(com.google.firebase.firestore.DocumentSnapshot snapshot, int session) {
    if (snapshot == null || !snapshot.exists() || snapshot.getMetadata().hasPendingWrites()) return;
    try {
      JSONObject next = SharedCatalog.decode(snapshot);
      boolean server = !snapshot.getMetadata().isFromCache();
      Long revisionValue = snapshot.getLong("revision");
      final long revision = revisionValue == null ? 0 : revisionValue;
      runOnUiThread(() -> {
        if (!resumed || isFinishing() || isDestroyed() || session != sharedSession) return;
        if (revision < sharedRevision) return;
        if (server) { sharedServerAt = System.currentTimeMillis(); sharedRevision = revision; }
        else if (sharedServerAt > 0) return;
        if (sharedAvailable && next.toString().equals(custom.toString())) return;
        boolean menuChanged = libraryShown(next) != libraryShown(custom);
        custom = next;
        sharedAvailable = true;
        sharedWorker.execute(() -> SharedCatalog.cache(this, next));
        channels = Catalog.merge(tdt, custom);
        lastRenderKey = tdt.toString() + custom.toString();
        View focused = getCurrentFocus();
        int focusId = focused == null ? View.NO_ID : focused.getId();
        if (menuChanged) home();
        else { renderFilters(); render(); }
        openPendingAppLink();
        View replacement = focusId == View.NO_ID ? null : root.findViewById(focusId);
        if (replacement != null) replacement.requestFocus();
      });
    } catch (Exception ignored) {}
  }

  protected void onDestroy() {
    Profiles.forget(profilesChanged);
    if (gate != null && gate.isShowing()) gate.dismiss();
    if (updater != null) updater.close();
    handler.removeCallbacksAndMessages(null);
    imageGeneration++;
    imageWorker.shutdownNow();
    prefetchWorker.shutdownNow();
    catalogWorker.shutdownNow();
    sharedWorker.shutdownNow();
    pendingImages.clear();
    lazySections.clear();
    images.evictAll();
    super.onDestroy();
  }

  // ---- Shared UI helpers and the user's local channels ---------------------------------------

  int dp(int n) {
    return (int) (getResources().getDisplayMetrics().density * n + .5f);
  }

  boolean wide() {
    return getResources().getConfiguration().screenWidthDp >= 700;
  }

  TextView text(String t, int size) {
    TextView v = new TextView(this);
    v.setText(t);
    v.setTextColor(FG);
    v.setTextSize(size);
    v.setPadding(dp(12), dp(7), dp(12), dp(7));
    return v;
  }

  TextView label(String t, int size, int color) {
    TextView v = text(t, size);
    v.setTextColor(color);
    return v;
  }

  Button button(String t, View.OnClickListener l) {
    Button b = Ui.pill(this, t, Ui.Kind.SURFACE, true);
    b.setOnClickListener(l);
    return b;
  }

  LinearLayout row() {
    LinearLayout r = new LinearLayout(this);
    r.setOrientation(LinearLayout.HORIZONTAL);
    r.setGravity(Gravity.CENTER_VERTICAL);
    return r;
  }

  void addButton(LinearLayout r, Button b) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, dp(44));
    p.setMargins(dp(4), dp(4), dp(4), dp(4));
    r.addView(b, p);
  }

  void image(final ImageView view, final String url) {
    image(view, url, false);
  }

  /** Logos and crests: the copy on the public web first (tools/logo_mirror.py), then the original. */
  void logo(final ImageView view, final String url) {
    image(view, url, true);
  }

  void image(final ImageView view, final String url, final boolean copyFirst) {
    if (url == null || !(url.startsWith("https://") || url.startsWith("data:image/"))) return;
    view.setTag(url);
    Bitmap cached = images.get(url);
    if (cached != null) { view.setImageBitmap(cached); return; }
    List<java.lang.ref.WeakReference<ImageView>> waiting = pendingImages.get(url);
    if (waiting != null) { waiting.add(new java.lang.ref.WeakReference<>(view)); return; }
    waiting = new ArrayList<>();
    waiting.add(new java.lang.ref.WeakReference<>(view));
    pendingImages.put(url, waiting);
    final int generation = imageGeneration;
    imageWorker.execute(() -> {
      Bitmap result = null;
      try {
        if (url.startsWith("data:image/")) {
          byte[] data = android.util.Base64.decode(url.substring(url.indexOf(',') + 1), android.util.Base64.DEFAULT);
          result = decodeBitmap(data);
        } else {
          String copy = copyFirst ? Catalog.mirror(url) : null;
          result = copy == null ? null : readBitmap(copy);
          if (result == null) result = readBitmap(url);
        }
      } catch (IllegalArgumentException ignored) {}
      final Bitmap bitmap = result;
      handler.post(() -> {
        if (generation != imageGeneration || isDestroyed()) return;
        List<java.lang.ref.WeakReference<ImageView>> targets = pendingImages.remove(url);
        if (bitmap == null) return;
        images.put(url, bitmap);
        if (targets != null) for (java.lang.ref.WeakReference<ImageView> ref : targets) {
          ImageView target = ref.get();
          if (target != null && url.equals(target.getTag())) target.setImageBitmap(bitmap);
        }
      });
    });
  }

  static Bitmap decodeBitmap(byte[] data) {
    BitmapFactory.Options o = new BitmapFactory.Options();
    o.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(data, 0, data.length, o);
    o.inSampleSize = 1;
    while (o.outWidth / o.inSampleSize > 960 || o.outHeight / o.inSampleSize > 540) o.inSampleSize *= 2;
    o.inJustDecodeBounds = false;
    return BitmapFactory.decodeByteArray(data, 0, data.length, o);
  }

  /** Pictures already downloaded, kept on the device: posters show at once the next time. */
  static File imageCacheDir;

  static File cachedImage(String address) {
    if (imageCacheDir == null) return null;
    try {
      java.security.MessageDigest sha = java.security.MessageDigest.getInstance("SHA-1");
      StringBuilder name = new StringBuilder();
      for (byte b : sha.digest(address.getBytes(java.nio.charset.StandardCharsets.UTF_8))) name.append(String.format(Locale.ROOT, "%02x", b & 255));
      return new File(imageCacheDir, name.toString());
    } catch (Exception impossible) { return null; }
  }

  /** The picture's bytes: from the device when it was downloaded before, else from the network (and kept). */
  static byte[] imageBytes(String address) {
    File file = cachedImage(address);
    if (file != null && file.isFile() && file.length() > 0) {
      try (FileInputStream in = new FileInputStream(file)) {
        byte[] data = new byte[(int) file.length()];
        int read = 0;
        for (int n; read < data.length && (n = in.read(data, read, data.length - read)) != -1;) read += n;
        if (read == data.length) { file.setLastModified(System.currentTimeMillis()); return data; }
      } catch (IOException broken) { file.delete(); }
    }
    byte[] data = downloadImage(address);
    if (data != null && file != null) {
      File part = new File(file.getPath() + ".part");
      try (FileOutputStream out = new FileOutputStream(part)) { out.write(data); }
      catch (IOException full) { part.delete(); return data; }
      if (!part.renameTo(file)) part.delete();
    }
    return data;
  }

  /** Keeps the pictures kept on the device under 80 MB, the oldest used go first. */
  static void trimImageCache() {
    File[] files = imageCacheDir == null ? null : imageCacheDir.listFiles();
    if (files == null) return;
    long total = 0;
    for (File f : files) total += f.length();
    if (total < 80L * 1024 * 1024) return;
    Arrays.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
    for (File f : files) { if (total < 60L * 1024 * 1024) break; total -= f.length(); f.delete(); }
  }

  /** The posters of the library downloaded ahead (one at a time, in the background), for the rows to show at once. */
  void prefetchPosters(Library.Data data) {
    final List<String> urls = new ArrayList<>();
    for (String[] section : Library.SECTIONS) for (Library.Item item : data.items(section[0]))
      if (item.poster.startsWith("https://") && urls.size() < 400) urls.add(item.poster);
    prefetchWorker.execute(() -> {
      for (String url : urls) {
        if (Thread.currentThread().isInterrupted()) return;
        File file = cachedImage(url);
        if (file != null && !file.isFile()) imageBytes(url);
      }
    });
  }

  /** An image read from the network, scaled down when large; null when it cannot be read. */
  static Bitmap readBitmap(String address) {
    byte[] data = imageBytes(address);
    Bitmap bitmap = data == null ? null : decodeBitmap(data);
    // A broken copy on the device is dropped, so the next time it is downloaded again.
    if (data != null && bitmap == null) { File file = cachedImage(address); if (file != null) file.delete(); }
    return bitmap;
  }

  static byte[] downloadImage(String address) {
    try {
      HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
      c.setConnectTimeout(6000);
      c.setReadTimeout(7000);
      try {
        if (c.getResponseCode() != 200) return null;
        InputStream in = c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
          if (out.size() + n > 5 * 1024 * 1024) return null;
          out.write(buf, 0, n);
        }
        in.close();
        return out.toByteArray();
      } finally {
        c.disconnect();
      }
    } catch (Exception e) {
      return null;
    }
  }


  boolean matches(String name) {
    return normalizeSearch(name).contains(normalizeSearch(query.trim()));
  }

  String normalizeSearch(String text) {
    return java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
  }

  void channelGrid(List<Catalog.Channel> items) {
    int cols = wide() ? 4 : 2;
    if (television) {
      for (int i = 0; i < items.size(); i += cols) {
        final List<Catalog.Channel> batch = new ArrayList<>(items.subList(i, Math.min(i + cols, items.size())));
        lazyRow(gridWidth(cols) * 9 / 16 + 100, () -> {
          LinearLayout row = row(); row.setGravity(Gravity.TOP);
          for (Catalog.Channel channel : batch) row.addView(card(channel, gridWidth(cols)));
          return row;
        });
      }
      return;
    }
    LinearLayout r = null;
    for (int i = 0; i < items.size(); i++) {
      if (i % cols == 0) { r = row(); r.setGravity(Gravity.TOP); list.addView(r); }
      r.addView(card(items.get(i), gridWidth(cols)));
    }
  }

  // ---- Films, series and documentaries (Google Drive videos, published to Firestore) ----------

  Library.Data library;
  String genre = "", genreSection = "", libPlatform = "", libOnly = "", libOrder = "";
  int libYear;
  final int genrePickerId = View.generateViewId(), yearPickerId = View.generateViewId(), platformPickerId = View.generateViewId(),
      orderPickerId = View.generateViewId(), releasesChipId = View.generateViewId(), arrivalsChipId = View.generateViewId();

  /** A drop-down pill: shows the choice and opens the list; "" is «all» (allLabel). */
  Button dropdown(final int id, String what, String current, final String allLabel, final List<String> values, final List<String> labels, final java.util.function.Consumer<String> set) {
    int at = values.indexOf(current);
    final Button picker = Ui.pill(this, (at < 0 ? allLabel : labels.get(at)) + "  ▾", Ui.Kind.SURFACE, true);
    picker.setId(id);
    picker.setContentDescription(what + ": " + (at < 0 ? allLabel : labels.get(at)));
    picker.setOnClickListener(v -> {
      PopupMenu menu = new PopupMenu(this, picker);
      menu.getMenu().add(0, 0, 0, allLabel);
      for (int i = 0; i < values.size(); i++) menu.getMenu().add(0, i + 1, i + 1, labels.get(i));
      menu.setOnMenuItemClickListener(choice -> {
        set.accept(choice.getItemId() == 0 ? "" : values.get(choice.getItemId() - 1));
        render();
        View again = root.findViewById(id);
        if (again != null) again.requestFocus();
        return true;
      });
      menu.show();
    });
    return picker;
  }
  boolean libraryBusy;
  long libraryAt;
  String libraryError = "";

  /** Downloads the list at most every 2 minutes; the page redraws when it arrives. */
  void loadLibrary() {
    if (libraryBusy || (library != null && System.currentTimeMillis() - libraryAt < 120000)) return;
    libraryBusy = true;
    final boolean first = library == null;
    new Thread(() -> {
      Library.Data data = null;
      String error = "";
      try {
        data = Library.download();
      } catch (Exception e) {
        error = e instanceof UnknownHostException ? "Sin conexión" : "No se pudo cargar el catálogo de vídeos";
      }
      final Library.Data result = data;
      final String failure = error;
      runOnUiThread(() -> {
        libraryBusy = false;
        if (result != null) { library = result; libraryAt = System.currentTimeMillis(); prefetchPosters(result); }
        libraryError = failure;
        // The home page also draws again the first time, for the titles «En portada» and the top.
        if (!isFinishing() && (Library.section(mode) != null || (result != null && "Inicio".equals(mode) && (first || !query.trim().isEmpty())))) render();
      });
    }).start();
  }

  void libraryPage(String section) {
    String name = "";
    for (String[] s : Library.SECTIONS) if (s[0].equals(section)) name = s[1];
    loadLibrary();
    if (library == null) {
      heading(name, null);
      list.addView(label(libraryBusy ? "Cargando…" : libraryError.isEmpty() ? "Cargando…" : libraryError, 15, MUTED));
      return;
    }
    // Filters as on the web: TMDB genre, year, platform (Spain), releases and new arrivals, and an order.
    if (!section.equals(genreSection)) { genreSection = section; genre = ""; libYear = 0; libPlatform = ""; libOnly = ""; libOrder = ""; }
    java.text.Collator collator = java.text.Collator.getInstance(Locale.forLanguageTag("es-ES"));
    TreeSet<String> genres = new TreeSet<>(collator), platforms = new TreeSet<>(collator);
    TreeSet<Integer> years = new TreeSet<>(Collections.reverseOrder());
    for (Library.Item item : library.items(section)) { genres.addAll(item.genres); platforms.addAll(item.providers); if (item.year > 0) years.add(item.year); }
    if (!genres.contains(genre)) genre = "";
    if (!platforms.contains(libPlatform)) libPlatform = "";
    if (!years.contains(libYear)) libYear = 0;
    List<Library.Item> named = new ArrayList<>();
    for (Library.Item item : library.items(section)) if (matches(item.title)) named.add(item);
    List<Library.Item> items = Library.filter(named, genre, libYear, libPlatform, libOnly, libOrder, System.currentTimeMillis());
    heading(name, items.size() == 1 ? "1 título" : items.size() + " títulos");
    LinearLayout pickers = row();
    List<String> genreOptions = new ArrayList<>(genres);
    if (!genres.isEmpty()) addButton(pickers, dropdown(genrePickerId, "Categoría", genre, "Todas las categorías", genreOptions, genreOptions, v -> genre = v));
    if (years.size() > 1) {
      List<String> values = new ArrayList<>(); for (Integer y : years) values.add(String.valueOf(y));
      addButton(pickers, dropdown(yearPickerId, "Año", libYear > 0 ? String.valueOf(libYear) : "", "Todos los años", values, values, v -> libYear = v.isEmpty() ? 0 : Integer.parseInt(v)));
    }
    List<String> platformOptions = new ArrayList<>(platforms);
    if (!platforms.isEmpty()) addButton(pickers, dropdown(platformPickerId, "Plataforma", libPlatform, "Todas las plataformas", platformOptions, platformOptions, v -> libPlatform = v));
    addButton(pickers, dropdown(orderPickerId, "Orden", libOrder, "Orden del catálogo", Arrays.asList("added", "year", "rating", "name"),
        Arrays.asList("Añadidas recientemente", "Más nuevas primero", "Mejor valoradas", "Por nombre (A-Z)"), v -> libOrder = v));
    for (final String[] o : new String[][] {{"estrenos", "Estrenos"}, {"nuevas", "Recién llegadas"}}) {
      final boolean on = libOnly.equals(o[0]);
      final int id = o[0].equals("estrenos") ? releasesChipId : arrivalsChipId;
      Button chip = Ui.pill(this, (on ? "✓ " : "") + o[1], on ? Ui.Kind.ACCENT : Ui.Kind.SURFACE, true);
      chip.setId(id);
      chip.setContentDescription(o[1] + (on ? ", activado" : ""));
      chip.setOnClickListener(v -> { libOnly = on ? "" : o[0]; render(); View again = root.findViewById(id); if (again != null) again.requestFocus(); });
      addButton(pickers, chip);
    }
    HorizontalScrollView scroller = new HorizontalScrollView(this);
    scroller.setHorizontalScrollBarEnabled(false);
    scroller.addView(pickers);
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(-1, -2);
    cp.setMargins(0, dp(6), 0, dp(16));
    list.addView(scroller, cp);
    boolean filtered = !genre.isEmpty() || libYear > 0 || !libPlatform.isEmpty() || !libOnly.isEmpty();
    if (!filtered && libOrder.isEmpty() && query.trim().isEmpty() && !items.isEmpty()) {
      browseRows(section, items);
      if (!library.attribution.isEmpty()) list.addView(label(library.attribution, 11, 0xff727b88));
      return;
    }
    if (items.isEmpty())
      list.addView(label(!query.trim().isEmpty() ? "Sin resultados" : filtered ? "No hay títulos con esos filtros." : "Todavía no hay vídeos en esta sección.", 15, MUTED));
    int columns = wide() ? 6 : 3;
    int width = gridWidth(columns);
    if (television) {
      for (int i = 0; i < items.size(); i += columns) {
        final List<Library.Item> batch = new ArrayList<>(items.subList(i, Math.min(i + columns, items.size())));
        lazyRow(width * 3 / 2 + 90, () -> {
          LinearLayout row = row(); row.setGravity(Gravity.TOP);
          for (Library.Item item : batch) row.addView(poster(item, width));
          return row;
        });
      }
    } else {
      LinearLayout r = null;
      for (int i = 0; i < items.size(); i++) {
        if (i % columns == 0) { r = row(); r.setGravity(Gravity.TOP); list.addView(r); }
        r.addView(poster(items.get(i), width));
      }
    }
    if (!library.attribution.isEmpty()) list.addView(label(library.attribution, 11, 0xff727b88));
  }

  /** A 2:3 poster with the title under it; without a TMDB poster the title is written on the card. */
  View poster(final Library.Item item, int width) {
    return poster(item, width, false);
  }

  /** `bare`: only the picture, as in the rows of a section page (the name is in the poster and read aloud). */
  View poster(final Library.Item item, int width, boolean bare) {
    LinearLayout card = new LinearLayout(this);
    card.setId(200000 + Math.abs(item.id.hashCode() % 800000));
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(dp(3), dp(3), dp(3), dp(8));
    card.setFocusable(true);
    card.setClickable(true);
    Ui.scaleOnFocus(card, 1.04f);
    FrameLayout art = new FrameLayout(this);
    art.setBackground(Ui.artBackground(this, Palette.hue(item.title), 10));
    art.setForeground(Ui.focusOutline(this, 10));
    art.setClipToOutline(true);
    art.setDuplicateParentStateEnabled(true);
    TextView fallback = label(item.title, 14, Ui.FG);
    fallback.setGravity(Gravity.CENTER);
    fallback.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    art.addView(fallback, new FrameLayout.LayoutParams(-1, -1));
    if (!item.poster.isEmpty()) {
      ImageView cover = new ImageView(this);
      cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
      art.addView(cover, new FrameLayout.LayoutParams(-1, -1));
      image(cover, item.poster);
    }
    if (item.trend > 0) {
      // «TOP 10» in the corner of the titles of the weekly top, as on Netflix (and on the web).
      TextView badge = label("TOP\n10", 10, 0xffffffff);
      badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      badge.setGravity(Gravity.CENTER);
      badge.setLineSpacing(0, 0.85f);
      badge.setBackground(Ui.shape(this, 0xffe50914, 3, 0, 0));
      badge.setPadding(dp(4), dp(2), dp(4), dp(3));
      badge.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
      art.addView(badge, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START));
    }
    String tag = Library.posterLabel(item, System.currentTimeMillis());
    if (!tag.isEmpty()) {
      // «Recién llegada» or «Nuevo episodio»: the red label of new titles, as on Netflix (and on the web).
      TextView ribbon = label(tag, 11, 0xffffffff);
      ribbon.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      ribbon.setGravity(Gravity.CENTER);
      ribbon.setSingleLine(true);
      ribbon.setBackground(Ui.shape(this, 0xffe50914, 4, 0, 0));
      ribbon.setPadding(dp(8), dp(3), dp(8), dp(3));
      FrameLayout.LayoutParams rp = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
      rp.setMargins(dp(4), 0, dp(4), dp(7));
      art.addView(ribbon, rp);
    }
    card.addView(art, new LinearLayout.LayoutParams(-1, Math.round(dp(width) * 1.5f)));
    if (bare) {
      card.setPadding(dp(3), dp(3), dp(3), dp(3));
      card.setContentDescription(item.title + (item.year > 0 ? ", " + item.year : "") + (item.trend > 0 ? ", top 10" : ""));
      card.setOnClickListener(v -> {
        String section = library == null ? null : library.sectionOf(item);
        if (section != null) libraryDetail(section, item);
      });
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -2);
      p.setMargins(dp(3), dp(4), dp(4), dp(6));
      card.setLayoutParams(p);
      return card;
    }
    TextView name = text(item.title, 13);
    name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    wholeName(name);
    name.setPadding(dp(2), dp(6), dp(2), 0);
    card.addView(name, new LinearLayout.LayoutParams(-1, 0, 1));
    TextView sub = label(item.year > 0 ? String.valueOf(item.year) : item.series ? "Serie" : "", 11, Ui.MUTED);
    sub.setPadding(dp(2), 0, dp(2), 0);
    card.addView(sub);
    card.setContentDescription(item.title + (item.year > 0 ? ", " + item.year : ""));
    card.setOnClickListener(v -> {
      String section = Library.section(mode);
      if (section == null && library != null) section = library.sectionOf(item);
      if (section != null) libraryDetail(section, item);
    });
    // As tall as the tallest card of its row, so the line under every name sits at the same height.
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -1);
    p.setMargins(dp(4), dp(4), dp(6), dp(6));
    card.setLayoutParams(p);
    return card;
  }

  /**
   * A title's page, as on Netflix: the backdrop, the platform, the title and its facts, a big white
   * «Reproducir», the synopsis, «Protagonizada por» and «Creada por» / «Dirigida por», «Compartir», and the
   * tabs «Episodios» (series), «Tráileres y más» (the trailer in Spanish) and «Similares».
   */
  private android.webkit.WebView trailerPreview;

  void libraryDetail(final String section, final Library.Item item) {
    final Dialog dialog = new Dialog(this, android.R.style.Theme_Material_NoActionBar);
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(0xff000000);
    final LinearLayout page = new LinearLayout(this);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setPadding(0, 0, 0, dp(28));
    scroll.addView(page);

    FrameLayout hero = new FrameLayout(this);
    hero.setBackground(Ui.heroBackground(this, Palette.hue(item.title)));
    String picture = item.backdrop.isEmpty() ? item.poster : item.backdrop;
    if (!picture.isEmpty()) {
      ImageView backdrop = new ImageView(this);
      backdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);
      hero.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));
      image(backdrop, picture);
    }
    final android.webkit.WebView preview;
    if (!item.trailer.isEmpty()) {
      preview = new android.webkit.WebView(this);
      trailerPreview = preview;
      preview.setAlpha(0f);
      preview.addJavascriptInterface(new Object() {
        @android.webkit.JavascriptInterface public void state(String state) {
          runOnUiThread(() -> {
            if (trailerPreview == preview) preview.setAlpha("playing".equals(state) || "blocked".equals(state) ? 1f : 0f);
          });
        }
      }, "CalamarTrailer");
      preview.setBackgroundColor(android.graphics.Color.TRANSPARENT);
      preview.getSettings().setJavaScriptEnabled(true);
      preview.getSettings().setDomStorageEnabled(true);
      preview.getSettings().setMediaPlaybackRequiresUserGesture(false);
      preview.getSettings().setAllowFileAccess(false);
      preview.getSettings().setAllowContentAccess(false);
      preview.setWebViewClient(new android.webkit.WebViewClient() {
        @Override public void onReceivedError(android.webkit.WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
          if (request.isForMainFrame()) view.setVisibility(View.GONE);
        }
        @Override public void onReceivedHttpError(android.webkit.WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceResponse response) {
          if (request.isForMainFrame()) view.setVisibility(View.GONE);
        }
      });
      hero.addView(preview, new FrameLayout.LayoutParams(-1, -1));
      preview.loadUrl("https://djyuanyo.github.io/Calamar-TV/trailer.html?v=" + item.trailer);
      dialog.setOnDismissListener(d -> {
        if (trailerPreview == preview) trailerPreview = null;
        preview.stopLoading(); preview.loadUrl("about:blank");
        hero.removeView(preview); preview.destroy();
      });
    } else preview = null;
    View scrim = new View(this);
    scrim.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, new int[] {0xff000000, 0x00000000, 0x00000000, 0x66000000}));
    if (preview == null) hero.addView(scrim, new FrameLayout.LayoutParams(-1, -1));
    Button back = Ui.pill(this, "‹", Ui.Kind.SURFACE, true);
    back.setContentDescription("Volver");
    back.setOnClickListener(v -> dialog.dismiss());
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.START);
    bp.setMargins(dp(gutter()), dp(12), 0, 0);
    hero.addView(back, bp);
    int screen = Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
    page.addView(hero, new LinearLayout.LayoutParams(-1, dp(Math.max(preview == null ? 0 : 240, Math.min(wide() ? 420 : 300, screen * 9 / 16)))));

    LinearLayout body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    body.setPadding(dp(gutter() + 4), dp(4), dp(gutter() + 4), 0);
    page.addView(body);
    if (!item.providers.isEmpty()) {
      String name = item.providers.get(0), logo = item.logos.get(name);
      JSONArray platforms = custom == null ? null : custom.optJSONArray("platforms");
      if (platforms != null) for (int i = 0; i < platforms.length(); i++) {
        JSONObject setting = platforms.optJSONObject(i);
        if (setting != null && name.equals(setting.optString("name")) && !setting.optString("logo").isEmpty()) logo = setting.optString("logo");
      }
      if (logo != null && !logo.isEmpty()) {
        ImageView brand = new ImageView(this);
        brand.setContentDescription(name);
        brand.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams logoSize = new LinearLayout.LayoutParams(dp(64), dp(64));
        logoSize.setMargins(0, 0, 0, dp(8));
        body.addView(brand, logoSize); image(brand, logo);
      } else body.addView(noPad(label(name, 18, 0xffe50914)));
    }
    TextView title = text(item.title, wide() ? 36 : 30);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setPadding(0, 0, 0, dp(4));
    body.addView(title);
    String facts = item.facts();
    if (!facts.isEmpty()) body.addView(noPad(label(facts, 15, 0xffb3b8c0)));
    final JSONObject progress = Library.Progress.load(this);
    if (item.series) {
      final Library.Episode next = Library.resumeEpisode(item, progress);
      if (next != null) {
        JSONObject saved = progress.optJSONObject(next.id);
        String text = (saved != null ? "Continuar T" : "Reproducir T") + next.season + ":E" + next.episode + (saved != null ? " · " + Library.clock(saved.optLong("position")) : "");
        bigPlay(body, text, () -> playEntry(item.entry(section, next), false)).requestFocus();
        if (saved != null) body.addView(progressBar(saved), progressBarParams(dp(4)));
      }
    } else {
      final JSONObject entry = item.entry(section, null);
      JSONObject saved = progress.optJSONObject(entry.optString("key"));
      bigPlay(body, saved == null ? "Reproducir" : "Continuar · " + Library.clock(saved.optLong("position")), () -> playEntry(entry, false)).requestFocus();
      if (saved != null) {
        Button restart = Ui.pill(this, "↺ Desde el principio", Ui.Kind.SURFACE, false);
        restart.setOnClickListener(v -> playEntry(entry, true));
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2);
        rp.setMargins(0, dp(8), 0, 0);
        body.addView(restart, rp);
        body.addView(progressBar(saved), progressBarParams(dp(4)));
      }
    }
    TextView overview = label(item.overview.isEmpty() ? "Sin sinopsis." : item.overview, 16, 0xffffffff);
    overview.setPadding(0, dp(14), 0, dp(8));
    overview.setLineSpacing(0, 1.15f);
    body.addView(overview);
    if (!item.cast.isEmpty()) {
      final List<String> names = new ArrayList<>();
      for (String[] person : item.cast) names.add(person[0]);
      final TextView starring = label("", 14, 0xffb3b8c0);
      final boolean[] all = {names.size() <= 3};
      final Runnable drawCast = () -> starring.setText(android.text.Html.fromHtml("<b>Protagonizada por:</b> "
          + android.text.TextUtils.htmlEncode(String.join(", ", all[0] ? names : names.subList(0, 3))) + (all[0] ? "" : "… <b>más</b>"), android.text.Html.FROM_HTML_MODE_LEGACY));
      drawCast.run();
      if (!all[0]) {
        // «más» can be reached with the remote of a television too.
        starring.setFocusable(true);
        starring.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 6, 0));
        starring.setOnClickListener(v -> { all[0] = true; drawCast.run(); });
      }
      body.addView(noPad(starring));
    }
    if (!item.creators.isEmpty())
      body.addView(noPad(credit(item.series ? "Creada por: " : "Dirigida por: ", String.join(", ", item.creators))));
    if (!item.genres.isEmpty()) body.addView(noPad(credit("Géneros: ", String.join(", ", item.genres))));
    // «Mi lista», «Me gusta» and «No me gusta» of the profile watching (in this device without an account).
    final String titlePage = Library.page(section);
    LinearLayout mine = row();
    final Button listButton = Ui.pill(this, "", Ui.Kind.SURFACE, true), up = Ui.pill(this, "", Ui.Kind.SURFACE, true), down = Ui.pill(this, "", Ui.Kind.SURFACE, true);
    final Runnable paintMine = () -> {
      JSONObject data = Profiles.data();
      listButton.setText(ProfileData.inList(data, titlePage, item.id) ? "✓  En mi lista" : "+  Mi lista");
      int rating = ProfileData.rating(data, titlePage, item.id);
      up.setText(rating > 0 ? "👍  Te gusta" : "👍  Me gusta");
      down.setText(rating < 0 ? "👎  No te gusta" : "👎  No me gusta");
    };
    paintMine.run();
    listButton.setOnClickListener(v -> { Profiles.toggleList(this, titlePage, item.id); paintMine.run(); });
    up.setOnClickListener(v -> { Profiles.rate(this, titlePage, item.id, 1); paintMine.run(); });
    down.setOnClickListener(v -> { Profiles.rate(this, titlePage, item.id, -1); paintMine.run(); });
    for (Button b : new Button[] {listButton, up, down}) {
      LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(-2, dp(44));
      mp.setMargins(0, dp(12), dp(8), 0);
      mine.addView(b, mp);
    }
    HorizontalScrollView mineScroll = new HorizontalScrollView(this);
    mineScroll.setHorizontalScrollBarEnabled(false);
    mineScroll.addView(mine);
    body.addView(mineScroll);
    Button share = Ui.pill(this, "⤴  Compartir", Ui.Kind.SURFACE, true);
    share.setOnClickListener(v -> {
      Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
          .putExtra(Intent.EXTRA_TEXT, item.title + " · https://djyuanyo.github.io/Calamar-TV/#/" + Library.page(section) + "/" + Uri.encode(item.id));
      try { startActivity(Intent.createChooser(send, "Compartir")); }
      catch (RuntimeException none) { Toast.makeText(this, "No hay ninguna aplicación para compartir.", Toast.LENGTH_SHORT).show(); }
    });
    LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, dp(44));
    sp.setMargins(0, dp(12), 0, dp(6));
    body.addView(share, sp);

    // The tabs.
    final LinearLayout tabs = row();
    final LinearLayout panel = new LinearLayout(this);
    panel.setOrientation(LinearLayout.VERTICAL);
    final List<String> tabNames = new ArrayList<>();
    if (item.series) tabNames.add("Episodios");
    tabNames.add("Tráileres y más");
    tabNames.add("Similares");
    final Runnable[] open = new Runnable[1];
    final String[] chosen = {item.series ? "Episodios" : !item.trailer.isEmpty() ? "Tráileres y más" : "Similares"};
    open[0] = () -> {
      tabs.removeAllViews();
      for (final String name : tabNames) {
        // The open tab has a red bar on top, as on Netflix.
        LinearLayout tab = new LinearLayout(this);
        tab.setOrientation(LinearLayout.VERTICAL);
        tab.setFocusable(true);
        tab.setClickable(true);
        tab.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 4, 0));
        View bar = new View(this);
        bar.setBackgroundColor(name.equals(chosen[0]) ? 0xffe50914 : 0x00000000);
        tab.addView(bar, new LinearLayout.LayoutParams(-1, dp(4)));
        TextView text = label(name, 16, name.equals(chosen[0]) ? 0xffffffff : 0xffb3b8c0);
        text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        text.setPadding(dp(4), dp(12), dp(4), dp(10));
        tab.addView(text);
        tab.setContentDescription(name + (name.equals(chosen[0]) ? ", seleccionada" : ""));
        tab.setOnClickListener(v -> { chosen[0] = name; open[0].run(); });
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(-2, -2);
        tp.setMargins(0, 0, dp(22), 0);
        tabs.addView(tab, tp);
      }
      panel.removeAllViews();
      if (chosen[0].equals("Episodios")) episodesTab(panel, section, item, progress);
      else if (chosen[0].equals("Tráileres y más")) trailerTab(panel, item);
      else similarTab(panel, section, item, dialog);
    };
    open[0].run();
    View line = new View(this);
    line.setBackgroundColor(0x33ffffff);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(1));
    lp.setMargins(0, dp(16), 0, 0);
    body.addView(line, lp);
    HorizontalScrollView tabScroll = new HorizontalScrollView(this);
    tabScroll.setHorizontalScrollBarEnabled(false);
    tabScroll.addView(tabs);
    body.addView(tabScroll);
    body.addView(panel);
    if (library != null && !library.attribution.isEmpty()) body.addView(label(library.attribution, 11, 0xff727b88));

    dialog.setContentView(scroll, new ViewGroup.LayoutParams(-1, -1));
    dialog.show();
    dialog.getWindow().setBackgroundDrawableResource(android.R.color.black);
    dialog.getWindow().setLayout(-1, -1);
  }

  TextView credit(String name, String value) {
    TextView v = label("", 14, 0xffb3b8c0);
    v.setText(android.text.Html.fromHtml("<b>" + android.text.TextUtils.htmlEncode(name) + "</b>" + android.text.TextUtils.htmlEncode(value), android.text.Html.FROM_HTML_MODE_LEGACY));
    return v;
  }

  /** The big white «Reproducir» of a title's page. */
  Button bigPlay(LinearLayout parent, String text, final Runnable action) {
    Button play = new Button(this);
    play.setText(text);
    play.setAllCaps(false);
    play.setTextSize(18);
    play.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    play.setTextColor(0xff111111);
    play.setBackground(Ui.focusFill(this, 0xffffffff, 0xffdddddd, Ui.ACC, 6, 0));
    play.setCompoundDrawablesWithIntrinsicBounds(Ui.icon(Ui.Icon.PLAY, 0xff111111, dp(20)), null, null, null);
    play.setCompoundDrawablePadding(dp(8));
    play.setPadding(dp(16), dp(10), dp(16), dp(10));
    play.setOnClickListener(v -> action.run());
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(56));
    p.setMargins(0, dp(14), 0, 0);
    parent.addView(play, p);
    return play;
  }

  /** «Episodios»: «Temporada N ▾» and the episodes of that season. */
  void episodesTab(final LinearLayout panel, final String section, final Library.Item item, JSONObject progress) {
    final Map<Integer, List<Library.Episode>> seasons = item.seasons();
    if (seasons.isEmpty()) return;
    Library.Episode next = Library.resumeEpisode(item, progress);
    final int[] current = {next != null && seasons.containsKey(next.season) ? next.season : seasons.keySet().iterator().next()};
    final Button picker = Ui.pill(this, "", Ui.Kind.SURFACE, false);
    final LinearLayout episodes = new LinearLayout(this);
    episodes.setOrientation(LinearLayout.VERTICAL);
    final Runnable draw = () -> {
      picker.setText("Temporada " + current[0] + "  ▾");
      episodes.removeAllViews();
      for (Library.Episode e : seasons.get(current[0])) episodes.addView(episodeRow(section, item, e));
    };
    picker.setOnClickListener(v -> {
      final List<Integer> numbers = new ArrayList<>(seasons.keySet());
      String[] labels = new String[numbers.size()];
      for (int i = 0; i < labels.length; i++) labels[i] = "Temporada " + numbers.get(i);
      new android.app.AlertDialog.Builder(this).setTitle("Temporada").setItems(labels, (d, which) -> { current[0] = numbers.get(which); draw.run(); }).show();
    });
    draw.run();
    LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(-2, dp(50));
    pp.setMargins(0, dp(10), 0, dp(10));
    panel.addView(picker, pp);
    panel.addView(episodes);
  }

  /** «Tráileres y más»: the trailer in Spanish (its YouTube picture opens it in YouTube). */
  void trailerTab(LinearLayout panel, final Library.Item item) {
    if (item.trailer.isEmpty()) { panel.addView(label("Este título no tiene tráiler en español.", 15, MUTED)); return; }
    FrameLayout card = new FrameLayout(this);
    card.setFocusable(true);
    card.setClickable(true);
    card.setBackground(Ui.shape(this, 0xff111111, 10, 0, 0));
    card.setForeground(Ui.focusOutline(this, 10));
    card.setClipToOutline(true);
    ImageView thumb = new ImageView(this);
    thumb.setScaleType(ImageView.ScaleType.CENTER_CROP);
    card.addView(thumb, new FrameLayout.LayoutParams(-1, -1));
    image(thumb, "https://img.youtube.com/vi/" + item.trailer + "/hqdefault.jpg");
    ImageView play = new ImageView(this);
    play.setImageDrawable(Ui.icon(Ui.Icon.PLAY, Ui.FG, dp(26)));
    play.setScaleType(ImageView.ScaleType.CENTER);
    play.setBackground(Ui.shape(this, 0xaa000000, 999, 2, 0xffffffff));
    card.addView(play, new FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER));
    card.setContentDescription("Ver el tráiler de " + item.title);
    card.setOnClickListener(v -> {
      try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=" + item.trailer))); }
      catch (RuntimeException none) { Toast.makeText(this, "No hay ninguna aplicación para abrir YouTube.", Toast.LENGTH_SHORT).show(); }
    });
    int screen = Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density) - 2 * (gutter() + 4);
    int width = Math.min(screen, 640);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), dp(width * 9 / 16));
    p.setMargins(0, dp(10), 0, dp(6));
    panel.addView(card, p);
    TextView caption = label("Tráiler · " + item.title, 14, 0xffb3b8c0);
    panel.addView(caption);
  }

  /** «Similares»: titles of the same section that share genres with this one. */
  void similarTab(LinearLayout panel, final String section, Library.Item item, final Dialog dialog) {
    List<Library.Item> found = library == null ? new ArrayList<Library.Item>() : Library.similar(library, section, item, 12);
    if (found.isEmpty()) { panel.addView(label("Todavía no hay títulos parecidos.", 15, MUTED)); return; }
    int columns = wide() ? 6 : 3;
    int screen = Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density) - 2 * (gutter() + 4);
    int width = screen / columns - 8;
    LinearLayout r = null;
    for (int i = 0; i < found.size(); i++) {
      if (i % columns == 0) { r = row(); r.setGravity(Gravity.TOP); panel.addView(r); }
      r.addView(poster(found.get(i), width, true));
    }
  }

  View episodeRow(final String section, final Library.Item item, final Library.Episode e) {
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setFocusable(true);
    box.setClickable(true);
    box.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 10, 0));
    box.setPadding(dp(2), dp(6), dp(2), dp(8));
    LinearLayout r = row();
    r.setDuplicateParentStateEnabled(true);
    FrameLayout still = new FrameLayout(this);
    still.setBackground(Ui.artBackground(this, Palette.hue(item.title), 6));
    still.setClipToOutline(true);
    TextView number = label(e.label(), 14, Ui.FG);
    number.setGravity(Gravity.CENTER);
    still.addView(number, new FrameLayout.LayoutParams(-1, -1));
    if (!e.still.isEmpty()) {
      ImageView image = new ImageView(this);
      image.setScaleType(ImageView.ScaleType.CENTER_CROP);
      still.addView(image, new FrameLayout.LayoutParams(-1, -1));
      image(image, e.still);
    }
    ImageView play = new ImageView(this);
    play.setImageDrawable(Ui.icon(Ui.Icon.PLAY, Ui.FG, dp(16)));
    play.setScaleType(ImageView.ScaleType.CENTER);
    play.setBackground(Ui.shape(this, 0x77000000, 999, 2, 0xffffffff));
    still.addView(play, new FrameLayout.LayoutParams(dp(38), dp(38), Gravity.CENTER));
    JSONObject saved = Library.Progress.load(this).optJSONObject(e.id);
    if (saved != null) {
      FrameLayout.LayoutParams barSize = new FrameLayout.LayoutParams(-1, dp(3), Gravity.BOTTOM);
      barSize.setMargins(dp(6), 0, dp(6), dp(5));
      still.addView(progressBar(saved), barSize);
    }
    r.addView(still, new LinearLayout.LayoutParams(dp(wide() ? 200 : 140), dp(wide() ? 112 : 79)));
    LinearLayout texts = new LinearLayout(this);
    texts.setOrientation(LinearLayout.VERTICAL);
    texts.setGravity(Gravity.CENTER_VERTICAL);
    TextView name = text(e.name.isEmpty() ? e.label() : e.episode + ". " + e.name, 16);
    name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    name.setPadding(dp(14), 0, dp(4), 0);
    texts.addView(name);
    if (e.runtime > 0) {
      TextView minutes = label(e.runtime + " min", 14, 0xffb3b8c0);
      minutes.setPadding(dp(14), dp(2), dp(4), 0);
      texts.addView(minutes);
    }
    r.addView(texts, new LinearLayout.LayoutParams(0, -1, 1));
    box.addView(r);
    if (!e.overview.isEmpty()) {
      TextView about = label(e.overview, 14, 0xffb3b8c0);
      about.setPadding(0, dp(8), 0, 0);
      about.setLineSpacing(0, 1.1f);
      box.addView(about);
    }
    box.setContentDescription(e.seasonLabel() + ", " + e.title());
    box.setOnClickListener(v -> episodePage(section, item, e));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(0, dp(6), 0, dp(6));
    box.setLayoutParams(p);
    return box;
  }

  /** Long names are shown whole, on as many lines as they need, with balanced line lengths. */
  void wholeName(TextView name) {
    name.setSingleLine(false);
    name.setMaxLines(Integer.MAX_VALUE);
    name.setEllipsize(null);
    if (Build.VERSION.SDK_INT >= 29) name.setBreakStrategy(android.graphics.text.LineBreaker.BREAK_STRATEGY_BALANCED);
    name.setLineSpacing(0, 1.05f);
  }

  TextView noPad(TextView v) {
    v.setPadding(0, dp(2), 0, dp(2));
    return v;
  }

  /** «▶ Reproducir», or «▶ Continuar · 12:34» and «Desde el principio» when it was left half watched. */
  void playButtons(LinearLayout parent, final JSONObject entry) {
    JSONObject saved = Library.Progress.load(this).optJSONObject(entry.optString("key"));
    LinearLayout actions = row();
    Button watch = Ui.pill(this, saved == null ? "Reproducir" : "Continuar · " + Library.clock(saved.optLong("position")), Ui.Kind.ACCENT, false);
    watch.setCompoundDrawablesWithIntrinsicBounds(Ui.icon(Ui.Icon.PLAY, Ui.BG, dp(18)), null, null, null);
    watch.setCompoundDrawablePadding(dp(8));
    watch.setOnClickListener(v -> playEntry(entry, false));
    addButton(actions, watch);
    if (saved != null) {
      Button restart = Ui.pill(this, "↺ Desde el principio", Ui.Kind.SURFACE, true);
      restart.setOnClickListener(v -> playEntry(entry, true));
      addButton(actions, restart);
    }
    HorizontalScrollView scroll = new HorizontalScrollView(this);
    scroll.setHorizontalScrollBarEnabled(false);
    scroll.addView(actions);
    parent.addView(scroll);
    if (saved != null) parent.addView(progressBar(saved), progressBarParams(dp(4)));
    watch.requestFocus();
  }

  /** The watched part of a film or episode, as a lime bar. */
  View progressBar(JSONObject saved) {
    long duration = saved.optLong("duration"), position = saved.optLong("position");
    float done = duration > 0 ? Math.min(1f, position / (float) duration) : 0f;
    LinearLayout track = new LinearLayout(this);
    track.setBackground(Ui.shape(this, 0x47ffffff, 2, 0, 0));
    View fill = new View(this);
    fill.setBackground(Ui.shape(this, Ui.ACC, 2, 0, 0));
    track.addView(fill, new LinearLayout.LayoutParams(0, -1, done));
    View rest = new View(this);
    track.addView(rest, new LinearLayout.LayoutParams(0, -1, 1f - done));
    return track;
  }

  LinearLayout.LayoutParams progressBarParams(int start) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(wide() ? 280 : 200), dp(4));
    p.setMargins(start, dp(6), 0, dp(4));
    return p;
  }

  /** An episode's own page: its image, «Capítulo N», its name and synopsis, and the play button. */
  void episodePage(final String section, final Library.Item item, final Library.Episode e) {
    final Dialog dialog = new Dialog(this, android.R.style.Theme_Material_NoActionBar);
    ScrollView scroll = new ScrollView(this);
    scroll.setBackgroundColor(Ui.BG);
    LinearLayout page = new LinearLayout(this);
    page.setOrientation(LinearLayout.VERTICAL);
    page.setPadding(0, 0, 0, dp(28));
    scroll.addView(page);

    FrameLayout hero = new FrameLayout(this);
    hero.setBackground(Ui.heroBackground(this, Palette.hue(item.title)));
    String picture = !e.still.isEmpty() ? e.still : item.backdrop;
    if (!picture.isEmpty()) {
      ImageView still = new ImageView(this);
      still.setScaleType(ImageView.ScaleType.CENTER_CROP);
      hero.addView(still, new FrameLayout.LayoutParams(-1, -1));
      image(still, picture);
    }
    View scrim = new View(this);
    scrim.setBackground(new GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, new int[] {0xff0b0d10, 0x660b0d10, 0x220b0d10}));
    hero.addView(scrim, new FrameLayout.LayoutParams(-1, -1));
    Button back = Ui.pill(this, "‹ " + item.title, Ui.Kind.SURFACE, true);
    back.setOnClickListener(v -> dialog.dismiss());
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-2, dp(44), Gravity.TOP | Gravity.START);
    bp.setMargins(dp(gutter()), dp(12), dp(gutter()), 0);
    hero.addView(back, bp);
    page.addView(hero, new LinearLayout.LayoutParams(-1, dp(wide() ? 320 : 220)));

    LinearLayout body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    body.setPadding(dp(gutter() + 6), 0, dp(gutter() + 6), 0);
    page.addView(body);
    body.addView(noPad(label(item.title + " · " + e.seasonLabel(), 14, Ui.MUTED)));
    TextView title = text(e.title(), wide() ? 34 : 28);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setPadding(0, dp(2), 0, 0);
    body.addView(title);
    String about = !e.overview.isEmpty() ? e.overview : !item.overview.isEmpty() ? item.overview : "Sin descripción.";
    TextView overview = label(about, 15, 0xffd6dbe2);
    overview.setPadding(0, dp(10), 0, dp(10));
    body.addView(overview);
    playButtons(body, item.entry(section, e));
    final Library.Episode next = item.next(e);
    if (next != null) {
      Button following = Ui.pill(this, "Siguiente: " + next.seasonLabel() + " · " + next.title() + " ›", Ui.Kind.SURFACE, true);
      following.setOnClickListener(v -> { dialog.dismiss(); episodePage(section, item, next); });
      LinearLayout r = row();
      addButton(r, following);
      body.addView(r);
    }
    if (library != null && !library.attribution.isEmpty()) body.addView(label(library.attribution, 11, 0xff727b88));
    dialog.setContentView(scroll, new ViewGroup.LayoutParams(-1, -1));
    dialog.show();
    dialog.getWindow().setBackgroundDrawableResource(android.R.color.black);
    dialog.getWindow().setLayout(-1, -1);
  }

  static final int PLAY_LIBRARY = 7;

  /**
   * Films and episodes are played like a direct video link, where this device left them; they do not
   * count in the channel audience. When one ends the player says so and the next episode starts.
   */
  void playEntry(JSONObject entry, boolean restart) {
    if (entry.optString("url").isEmpty()) {
      // Left half watched on another device: the link and the marks come from the library.
      JSONObject full = libraryEntry(entry);
      if (full == null) {
        loadLibrary();
        Toast.makeText(this, library == null ? "Cargando el catálogo de vídeos…" : "Este título ya no está en el catálogo.", Toast.LENGTH_SHORT).show();
        return;
      }
      entry = full;
    }
    String url = entry.optString("url");
    if (!Library.Media.allowed(url)) return;
    String anon = Library.Media.anonmp4(url);
    if (anon != null) { embedPlayer(entry.optString("title"), anon); return; }
    JSONObject saved = Library.Progress.load(this).optJSONObject(entry.optString("key"));
    // What the profile watches feeds «Recomendado para ti».
    if (Profiles.signedIn() && Profiles.active() != null && !entry.optString("section").isEmpty())
      Profiles.markWatched(this, Library.page(entry.optString("section")), entry.optString("item"));
    Intent intent = new Intent(this, NativePlayerActivity.class);
    String embed = Library.Media.embed(url);
    if (embed != null) { // LuluStream: the video is read from its player page; if not, the page itself is shown
      intent.putExtra("page_url", embed);
      intent.putExtra("football_fallback", true);
    } else intent.putStringArrayListExtra("media_urls", new ArrayList<>(Collections.singletonList(url)));
    intent.putExtra("title", entry.optString("title"));
    intent.putExtra("progress_entry", entry.toString());
    // Its own statistics (l:<id>, all the episodes of a series together), without «people watching».
    String audienceTarget = AudienceModel.libraryTarget(entry.optString("item"));
    if (audienceTarget != null) intent.putExtra("audience_target", audienceTarget);
    intent.putExtra("resume_ms", restart || saved == null ? 0 : saved.optLong("position"));
    startActivityForResult(intent, PLAY_LIBRARY);
  }

  /**
   * AnonMP4: its embed page (the address its API gives for other sites) with its own player, full screen.
   * Back closes it. «Continuar viendo» cannot know where it was left, as the player is AnonMP4's.
   */
  void embedPlayer(String title, String address) {
    final Dialog dialog = new Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
    final FrameLayout box = new FrameLayout(this);
    box.setBackgroundColor(0xff000000);
    final android.webkit.WebView web = new android.webkit.WebView(this);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setMediaPlaybackRequiresUserGesture(false);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    web.setBackgroundColor(0xff000000);
    final String host = Uri.parse(address).getHost();
    web.setWebViewClient(new android.webkit.WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(android.webkit.WebView view, android.webkit.WebResourceRequest request) {
        // Only AnonMP4's own pages: pop-ups and adverts that try to open other sites stay closed.
        return !host.equals(request.getUrl().getHost());
      }
    });
    web.setWebChromeClient(new android.webkit.WebChromeClient() {
      View full;
      @Override
      public void onShowCustomView(View view, CustomViewCallback callback) {
        full = view;
        box.addView(view, new FrameLayout.LayoutParams(-1, -1));
      }
      @Override
      public void onHideCustomView() {
        if (full != null) box.removeView(full);
        full = null;
      }
    });
    box.addView(web, new FrameLayout.LayoutParams(-1, -1));
    dialog.setContentView(box);
    dialog.setOnDismissListener(d -> { web.loadUrl("about:blank"); web.destroy(); });
    dialog.show();
    web.loadUrl(address);
    web.requestFocus();
    Toast.makeText(this, title, Toast.LENGTH_SHORT).show();
  }

  // ---- Films and series «En portada» and the weekly top ----

  /** A film or series «En portada» as an entry of the featured slider (id «lib:<section>/<id>»). */
  Catalog.Channel libraryHero(Library.Item item) {
    String section = library.sectionOf(item);
    String kind = section == null ? "Película" : section.equals("series") ? "Serie" : section.equals("documentaries") ? "Documental" : "Película";
    StringBuilder line = new StringBuilder(kind);
    if (item.year > 0) line.append(" · ").append(item.year);
    if (!item.genres.isEmpty()) line.append(" · ").append(android.text.TextUtils.join(", ", item.genres.subList(0, Math.min(2, item.genres.size()))));
    if (item.rating > 0) line.append(" · ★ ").append(String.format(new Locale("es", "ES"), "%.1f", item.rating));
    try {
      return new Catalog.Channel(new JSONObject().put("id", "lib:" + section + "/" + item.id).put("name", item.title).put("event", true)
          .put("cover", item.backdrop.isEmpty() ? item.poster : item.backdrop).put("logo", item.poster).put("meta", line.toString())
          .put("region", item.series ? "series" : "film"), false);
    } catch (JSONException impossible) {
      throw new IllegalStateException(impossible);
    }
  }

  static boolean isLibraryHero(Catalog.Channel c) {
    return c != null && c.id.startsWith("lib:");
  }

  /** «Ver ahora» plays a film; a series (or «Más información») opens its page. */
  void openLibraryHero(Catalog.Channel c, boolean page) {
    String[] parts = c.id.substring(4).split("/", 2);
    Library.Item item = library == null || parts.length < 2 ? null : library.find(parts[0], parts[1]);
    if (item == null) { Toast.makeText(this, "Este título ya no está en el catálogo.", Toast.LENGTH_SHORT).show(); return; }
    if (!page && !item.series && !item.url.isEmpty()) playEntry(item.entry(parts[0], null), false);
    else libraryDetail(parts[0], item);
  }

  /** «Top 10 películas / series de la semana» (or as many as there are): big numbers next to the posters, as on Netflix. */
  void topRow(List<Library.Item> items, String what) {
    topRow(items, what, "Top " + items.size() + " " + what + " de la semana");
  }

  void topRow(List<Library.Item> items, String what, String title) {
    if (items.isEmpty()) return;
    heading(title, "Según TMDB");
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    h.setClipToPadding(false);
    LinearLayout r = row();
    r.setGravity(Gravity.BOTTOM);
    // Bigger than the posters of the other rows, and whole (only the picture, at 2:3).
    int width = wide() ? 190 : 140;
    for (int i = 0; i < items.size(); i++) {
      LinearLayout pair = row();
      pair.setGravity(Gravity.BOTTOM);
      TextView rank = new TextView(this);
      rank.setText(String.valueOf(i + 1));
      rank.setTextSize(wide() ? 120 : 92);
      rank.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      rank.setTextColor(0x99ffffff);
      rank.setIncludeFontPadding(false);
      rank.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
      LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-2, -2);
      rp.setMargins(dp(4), 0, dp(-12), dp(6));
      pair.addView(rank, rp);
      View card = poster(items.get(i), width, true);
      card.setContentDescription("Número " + (i + 1) + ": " + items.get(i).title);
      pair.addView(card, card.getLayoutParams());
      r.addView(pair);
    }
    h.addView(r);
    list.addView(h);
  }

  static final String HALLOWEEN = "Especial Halloween";

  /** The signed-in user's first name, for «Seguir viendo para …» (empty without an account). */
  String userName() {
    try {
      com.google.firebase.auth.FirebaseUser user = SharedCatalog.auth(this).getCurrentUser();
      String name = user == null || user.getDisplayName() == null ? "" : user.getDisplayName().trim();
      return name.isEmpty() ? "" : name.split("\\s+")[0];
    } catch (RuntimeException unavailable) {
      return "";
    }
  }

  /** A section page without filters: rows as on Netflix, in the web's order (Library.browseRows). */
  void browseRows(String section, List<Library.Item> items) {
    java.util.Set<String> watched = new HashSet<>();
    for (JSONObject entry : Library.Progress.list(Library.Progress.load(this)))
      if (section.equals(entry.optString("section"))) watched.add(entry.optString("item"));
    heroSlider(section, Library.heroTitles(items, System.currentTimeMillis(), 8));
    platformButtons(section, Library.platforms(items, custom == null ? null : custom.optJSONArray("platforms")));
    for (Library.Row row : Library.browseRows(section, items, watched, userName(), System.currentTimeMillis())) {
      if (row.kind.equals("continue")) continueRow(section, row.title);
      else if (row.kind.equals("horror")) {
        List<Object[]> entries = new ArrayList<>();
        for (Library.Item item : row.items) entries.add(new Object[] {section, item});
        // «Descubrir todo»: every horror title of this section, as when «Terror» is chosen in the categories.
        horrorBanner(row.title, entries, () -> { genre = "Terror"; render(); });
      }
      else if (row.kind.equals("top")) topRow(row.items, "", row.title);
      else posterRail(row.title, row.items, row.kind.equals("big") ? (wide() ? 230 : 170) : (wide() ? 140 : 108));
    }
  }

  /** A titled row of posters that scrolls sideways. */
  void posterRail(String title, final List<Library.Item> items, final int width) {
    heading(title, null);
    java.util.concurrent.Callable<View> rail = () -> {
      HorizontalScrollView h = new HorizontalScrollView(this);
      h.setHorizontalScrollBarEnabled(false);
      h.setClipToPadding(false);
      LinearLayout r = row();
      r.setGravity(Gravity.TOP);
      for (Library.Item item : items) r.addView(poster(item, width, true));
      h.addView(r);
      return h;
    };
    // On a television the rows far from the screen are built when they come near (as the poster grid).
    if (television) lazyRow(width * 3 / 2 + 24, rail);
    else {
      try { list.addView(rail.call()); } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
  }

  static final String PLATFORM = "Plataforma: ";
  static final String LEAGUE = "Liga: ";
  static final String LIVE = "En directo";

  /** Every event of «Eventos En Directo» in a grid per competition, in the order of the leagues (as #/directo on the web). */
  void livePage() {
    Button back = Ui.pill(this, "‹ Inicio", Ui.Kind.SURFACE, true);
    back.setOnClickListener(v -> { mode = "Inicio"; home(); });
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, dp(44));
    bp.setMargins(0, dp(10), 0, dp(6));
    list.addView(back, bp);
    List<Catalog.Channel> live = Catalog.liveEvents(Catalog.events(channels, custom), System.currentTimeMillis());
    sportsHero(Catalog.LIVE_ROW, "", "", live.size() == 1 ? "1 evento hoy, ordenado por competición" : live.size() + " eventos hoy, ordenados por competición", SportsCatalog.liveLink(), true);
    for (Catalog.EventRow row : Catalog.eventRows(live, custom)) {
      heading(row.id.isEmpty() ? row.name : row.name + "  ›", row.events.size() == 1 ? "1 evento" : row.events.size() + " eventos");
      if (!row.logo.isEmpty()) leagueLogo(row.logo);
      if (!row.id.isEmpty()) leagueHeadingOpens(row.id, row.name);
      channelGrid(row.events);
    }
    if (live.isEmpty()) list.addView(label("Ahora mismo no hay eventos en directo.", 15, MUTED));
  }

  /** The heading just added opens the league's page (its name ends in «›»). */
  void leagueHeadingOpens(final String leagueId, String name) {
    View heading = list.getChildAt(list.getChildCount() - 1);
    heading.setFocusable(true);
    heading.setClickable(true);
    heading.setBackground(Ui.focusFill(this, 0x00000000, 0x22ffffff, Ui.ACC, 8, 0));
    heading.setContentDescription("Todos los partidos de " + name);
    heading.setOnClickListener(v -> { mode = LEAGUE + leagueId; query = ""; home(); });
  }

  /** A league's page: its logo on its background, «Compartir» and every match of the league with a channel. */
  void leaguePage(String leagueId) {
    Button back = Ui.pill(this, "‹ Inicio", Ui.Kind.SURFACE, true);
    back.setOnClickListener(v -> { mode = "Inicio"; home(); });
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, dp(44));
    bp.setMargins(0, dp(10), 0, dp(6));
    list.addView(back, bp);
    JSONObject league = SportsCatalog.find(custom == null ? null : custom.optJSONArray("leagues"), leagueId);
    if (league == null) { list.addView(label("Esta liga ya no está en el catálogo.", 15, MUTED)); return; }
    final String name = league.optString("name");
    // All linked matches of the current week, Monday to Sunday in Madrid.
    List<Catalog.Channel> matches = Catalog.leagueEvents(channels, custom, leagueId, System.currentTimeMillis());
    final String slug = SportsCatalog.leagueSlugs(custom).get(leagueId);
    sportsHero(name, league.optString("logo"), league.optString("background"),
        matches.size() == 1 ? "1 partido esta semana con enlace" : matches.size() + " partidos esta semana con enlace",
        slug == null ? null : SportsCatalog.leagueLink(slug), false);
    if (matches.isEmpty()) list.addView(label("Esta semana no hay partidos de esta liga con enlace.", 15, MUTED));
    else channelGrid(matches);
  }

  /** Shared league/live header, with the app's bundled logo for mixed competitions. */
  void sportsHero(String name, String logo, String background, String subtitle, String shareUrl, boolean branded) {
    FrameLayout hero = new FrameLayout(this);
    hero.setBackground(Ui.shape(this, 0xff14261b, 14, 0, 0));
    hero.setClipToOutline(true);
    if (background.startsWith("https://") || background.startsWith("data:image/")) {
      ImageView art = new ImageView(this);
      art.setScaleType(ImageView.ScaleType.CENTER_CROP);
      hero.addView(art, new FrameLayout.LayoutParams(-1, -1));
      image(art, background);
    }
    View shade = new View(this);
    shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0x550b0d10, 0x990b0d10, 0xee0b0d10}));
    hero.addView(shade, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setGravity(Gravity.CENTER_HORIZONTAL);
    box.setPadding(dp(12), dp(18), dp(12), dp(16));
    if (branded || logo.startsWith("https://") || logo.startsWith("data:image/")) {
      ImageView icon = new ImageView(this);
      icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
      box.addView(icon, new LinearLayout.LayoutParams(dp(wide() ? 110 : 88), dp(wide() ? 110 : 88)));
      if (branded) icon.setImageResource(R.drawable.calamar_menciano_tv);
      else logo(icon, logo);
      icon.setContentDescription(branded ? "Calamar TV" : name);
    }
    TextView title = label(name, wide() ? 32 : 26, 0xffffffff);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    title.setShadowLayer(dp(8), 0, dp(2), 0xcc000000);
    box.addView(title);
    TextView count = label(subtitle, 14, 0xddffffff);
    count.setGravity(Gravity.CENTER);
    box.addView(count);
    Button share = Ui.pill(this, "⤴  Compartir", Ui.Kind.SURFACE, true);
    share.setOnClickListener(v -> {
      Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, name + " · " + shareUrl);
      try { startActivity(Intent.createChooser(send, "Compartir")); }
      catch (RuntimeException none) { Toast.makeText(this, "No hay ninguna aplicación para compartir.", Toast.LENGTH_SHORT).show(); }
    });
    LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-2, dp(44));
    sp.gravity = Gravity.CENTER_HORIZONTAL;
    sp.setMargins(0, dp(10), 0, 0);
    if (shareUrl != null) box.addView(share, sp);
    hero.addView(box, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER));
    LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(-1, -2);
    hp.setMargins(0, 0, 0, dp(14));
    list.addView(hero, hp);
  }

  /** The section a platform's page was opened from, to go back to it. */
  String platformFrom = "Películas";
  HorizontalScrollView browseTrack;
  final Runnable browseAdvance = new Runnable() { public void run() {
    HorizontalScrollView track = browseTrack;
    if (track == null || !track.isAttachedToWindow() || track.getChildCount() == 0) return;
    View row = track.getChildAt(0);
    int step = row instanceof ViewGroup && ((ViewGroup) row).getChildCount() > 0 ? ((ViewGroup) row).getChildAt(0).getWidth() + dp(12) : track.getWidth();
    boolean end = track.getScrollX() + track.getWidth() >= row.getWidth() - dp(8);
    if (!track.isPressed()) track.smoothScrollTo(end ? 0 : track.getScrollX() + step, 0);
    handler.postDelayed(this, 6000);
  } };

  /** The tagline of a slide: «Nuevo episodio disponible», «Recién llegada», «Nº 1 de la semana»… (as on the web). */
  static String heroTagline(Library.Item item, long now) {
    String label = Library.posterLabel(item, now);
    if (label.equals("Nuevo episodio")) return "Nuevo episodio disponible";
    if (!label.isEmpty()) return label;
    return item.trend > 0 ? "Nº " + item.trend + " de la semana" : "";
  }

  /** The slider at the top of a section, as on Disney+: big cards that move by themselves every six seconds. */
  void heroSlider(final String section, List<Library.Item> items) {
    if (items.isEmpty()) return;
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    h.setClipToPadding(false);
    LinearLayout r = row();
    int screen = Math.round(getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density);
    int width = wide() ? Math.min(900, screen * 70 / 100) : screen * 84 / 100;
    int height = wide() ? width * 7 / 16 : width * 5 / 4;
    long now = System.currentTimeMillis();
    for (final Library.Item item : items) {
      FrameLayout card = new FrameLayout(this);
      card.setFocusable(true);
      card.setClickable(true);
      card.setBackground(Ui.artBackground(this, Palette.hue(item.title), 14));
      card.setForeground(Ui.focusOutline(this, 14));
      card.setClipToOutline(true);
      Ui.scaleOnFocus(card, 1.02f);
      String picture = wide() ? (item.backdrop.isEmpty() ? item.poster : item.backdrop) : (item.poster.isEmpty() ? item.backdrop : item.poster);
      if (!picture.isEmpty()) {
        ImageView art = new ImageView(this);
        art.setScaleType(ImageView.ScaleType.CENTER_CROP);
        card.addView(art, new FrameLayout.LayoutParams(-1, -1));
        image(art, picture);
      }
      View shade = new View(this);
      shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0x00000000, 0x00000000, 0xdd000000}));
      card.addView(shade, new FrameLayout.LayoutParams(-1, -1));
      LinearLayout text = new LinearLayout(this);
      text.setOrientation(LinearLayout.VERTICAL);
      text.setGravity(Gravity.CENTER_HORIZONTAL);
      text.setPadding(dp(14), 0, dp(14), dp(16));
      TextView name = label(item.title, wide() ? 26 : 22, 0xffffffff);
      name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      name.setGravity(Gravity.CENTER);
      name.setShadowLayer(dp(6), 0, dp(2), 0x99000000);
      text.addView(name);
      String tagline = heroTagline(item, now);
      if (!tagline.isEmpty()) {
        TextView tag = label(tagline, 15, 0xffffffff);
        tag.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        tag.setGravity(Gravity.CENTER);
        text.addView(tag);
      }
      String meta = (item.year > 0 ? item.year + "" : "") + (!item.genres.isEmpty() ? (item.year > 0 ? " • " : "") + item.genres.get(0) : "");
      if (!meta.isEmpty()) {
        TextView m = label(meta, 14, 0xddffffff);
        m.setGravity(Gravity.CENTER);
        text.addView(m);
      }
      card.addView(text, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
      card.setContentDescription(item.title + (tagline.isEmpty() ? "" : ", " + tagline));
      card.setOnClickListener(v -> libraryDetail(section, item));
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), dp(height));
      p.setMargins(0, dp(4), dp(12), dp(6));
      r.addView(card, p);
    }
    h.addView(r);
    LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(-1, -2);
    hp.setMargins(0, dp(4), 0, dp(4));
    list.addView(h, hp);
    browseTrack = h;
    handler.removeCallbacks(browseAdvance);
    if (resumed && !television && items.size() > 1) handler.postDelayed(browseAdvance, 6000);
  }

  /** The platform buttons under the slider (logo from TMDB, or its name), each opening the platform's page. */
  void platformButtons(final String section, List<String[]> platforms) {
    if (platforms.isEmpty()) return;
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    LinearLayout r = row();
    for (final String[] p : platforms) {
      FrameLayout tile = new FrameLayout(this);
      tile.setFocusable(true);
      tile.setClickable(true);
      tile.setBackground(Ui.shape(this, 0xff23262e, 10, 1, 0x33ffffff));
      tile.setForeground(Ui.focusOutline(this, 10));
      Ui.scaleOnFocus(tile, 1.06f);
      if (!p[1].isEmpty()) {
        ImageView logo = new ImageView(this);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setClipToOutline(true);
        logo.setBackground(Ui.shape(this, 0x00000000, 10, 0, 0));
        tile.addView(logo, new FrameLayout.LayoutParams(dp(42), dp(42), Gravity.CENTER));
        image(logo, p[1]);
      } else {
        TextView name = label(p[0], 12, Ui.FG);
        name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        name.setGravity(Gravity.CENTER);
        tile.addView(name, new FrameLayout.LayoutParams(-1, -1));
      }
      tile.setContentDescription(p[0]);
      tile.setOnClickListener(v -> { platformFrom = mode; mode = PLATFORM + p[0]; query = ""; home(); });
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(wide() ? 130 : 104), dp(wide() ? 80 : 64));
      lp.setMargins(0, dp(6), dp(10), dp(6));
      r.addView(tile, lp);
    }
    h.addView(r);
    list.addView(h);
  }

  /**
   * A platform's page, as on Disney+ (Marvel): its logo over the backdrop of one of its titles (a different
   * one, at random, every time) and its titles in rows: «En primer plano», by section and by genre.
   */
  void platformPage(String name) {
    loadLibrary();
    Button back = Ui.pill(this, "‹ Volver", Ui.Kind.SURFACE, true);
    back.setOnClickListener(v -> { mode = Library.section(platformFrom) != null ? platformFrom : "Películas"; home(); });
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, dp(44));
    bp.setMargins(0, dp(10), 0, dp(6));
    list.addView(back, bp);
    if (library == null) { heading(name, null); list.addView(label(libraryError.isEmpty() ? "Cargando…" : libraryError, 15, MUTED)); return; }
    List<Library.Item> all = new ArrayList<>();
    List<Library.Row> rows = Library.platformRows(library, name, System.currentTimeMillis(), all);
    FrameLayout hero = new FrameLayout(this);
    hero.setBackground(Ui.shape(this, 0xff1b1e25, 14, 0, 0));
    hero.setClipToOutline(true);
    List<String> backdrops = new ArrayList<>();
    String logo = "";
    for (Library.Item item : all) {
      if (!item.backdrop.isEmpty()) backdrops.add(item.backdrop);
      if (logo.isEmpty() && item.logos.containsKey(name)) logo = item.logos.get(name);
    }
    // The logo set in the admin page goes before TMDB's.
    for (String[] p : Library.platforms(all, custom == null ? null : custom.optJSONArray("platforms"))) if (p[0].equals(name) && !p[1].isEmpty()) logo = p[1];
    if (!backdrops.isEmpty()) {
      ImageView art = new ImageView(this);
      art.setScaleType(ImageView.ScaleType.CENTER_CROP);
      hero.addView(art, new FrameLayout.LayoutParams(-1, -1));
      image(art, backdrops.get(new java.util.Random().nextInt(backdrops.size())));
    }
    View shade = new View(this);
    shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0x220b0d10, 0x660b0d10, 0xff0b0d10}));
    hero.addView(shade, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setGravity(Gravity.CENTER_HORIZONTAL);
    box.setPadding(dp(12), 0, dp(12), dp(18));
    if (!logo.isEmpty()) {
      ImageView icon = new ImageView(this);
      icon.setScaleType(ImageView.ScaleType.FIT_CENTER);
      icon.setClipToOutline(true);
      icon.setBackground(Ui.shape(this, 0x00000000, 20, 0, 0));
      box.addView(icon, new LinearLayout.LayoutParams(dp(wide() ? 120 : 96), dp(wide() ? 120 : 96)));
      image(icon, logo);
    }
    TextView title = label(name, wide() ? 36 : 30, 0xffffffff);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setGravity(Gravity.CENTER);
    title.setShadowLayer(dp(8), 0, dp(2), 0xcc000000);
    box.addView(title);
    box.addView(label(all.size() == 1 ? "1 título" : all.size() + " títulos", 14, 0xddffffff));
    hero.addView(box, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
    list.addView(hero, new LinearLayout.LayoutParams(-1, dp(wide() ? 340 : 280)));
    if (all.isEmpty()) list.addView(label("Todavía no hay títulos de " + name + ".", 15, MUTED));
    for (Library.Row row : rows) posterRail(row.title, row.items, wide() ? 140 : 108);
    if (!library.attribution.isEmpty()) list.addView(label(library.attribution, 11, 0xff727b88));
  }

  /** The home page block of «Especial Halloween»: a dark banner with the horror titles and «Descubrir todo». */
  void halloweenRow() {
    horrorBanner("Especial Halloween", Library.horror(library), () -> { mode = HALLOWEEN; query = ""; home(); });
  }

  /** The dark horror banner (Especial Halloween, and the horror row of each section): titles and «Descubrir todo». */
  void horrorBanner(String heading, List<Object[]> horror, final Runnable discover) {
    if (horror.isEmpty()) return;
    FrameLayout banner = new FrameLayout(this);
    String backdrop = "";
    for (Object[] pair : horror) if (!((Library.Item) pair[1]).backdrop.isEmpty()) { backdrop = ((Library.Item) pair[1]).backdrop; break; }
    if (!backdrop.isEmpty()) {
      ImageView art = new ImageView(this);
      art.setScaleType(ImageView.ScaleType.CENTER_CROP);
      art.setAlpha(0.55f);
      banner.addView(art, new FrameLayout.LayoutParams(-1, -1));
      image(art, backdrop);
    }
    View shade = new View(this);
    shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0x990b0d10, 0x330b0d10, 0xee0b0d10}));
    banner.addView(shade, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(16), dp(22), 0, dp(18));
    box.addView(halloweenTitle(heading.toUpperCase(new Locale("es", "ES"))));
    TextView kicker = label("COLECCIÓN DE TERROR", 12, 0xffe7dccb);
    kicker.setLetterSpacing(0.2f);
    kicker.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    kicker.setPadding(0, dp(4), 0, dp(10));
    box.addView(kicker);
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    LinearLayout r = row();
    r.setGravity(Gravity.TOP);
    int width = wide() ? 140 : 108;
    for (int i = 0; i < Math.min(horror.size(), Library.ROW_LIMIT); i++) r.addView(poster((Library.Item) horror.get(i)[1], width, true));
    h.addView(r);
    box.addView(h);
    Button all = Ui.pill(this, "Descubrir todo", Ui.Kind.ACCENT, false);
    all.setOnClickListener(v -> discover.run());
    LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(-2, -2);
    ap.gravity = Gravity.CENTER_HORIZONTAL;
    ap.setMargins(0, dp(10), dp(16), 0);
    box.addView(all, ap);
    banner.addView(box, new FrameLayout.LayoutParams(-1, -2));
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-1, -2);
    bp.setMargins(0, dp(22), 0, dp(6));
    banner.setClipToOutline(true);
    banner.setBackground(Ui.shape(this, 0xff16090b, 14, 0, 0));
    list.addView(banner, bp);
  }

  TextView halloweenTitle(String text) {
    TextView title = label(text, wide() ? 38 : 30, 0xffff2a12);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setShadowLayer(dp(8), 0, 0, 0xccff3c14);
    return title;
  }

  /** «Especial Halloween»: every horror title of the library, by section. */
  void halloweenPage() {
    loadLibrary();
    Button back = Ui.pill(this, "‹ Inicio", Ui.Kind.SURFACE, true);
    back.setOnClickListener(v -> { mode = "Inicio"; home(); });
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, dp(44));
    bp.setMargins(0, dp(10), 0, dp(6));
    list.addView(back, bp);
    list.addView(halloweenTitle("ESPECIAL HALLOWEEN"));
    if (library == null) { list.addView(label(libraryError.isEmpty() ? "Cargando…" : libraryError, 15, MUTED)); return; }
    List<Object[]> horror = Library.horror(library);
    list.addView(label(horror.size() == 1 ? "1 título para pasar miedo" : horror.size() + " títulos para pasar miedo", 14, 0xffe7dccb));
    if (horror.isEmpty()) list.addView(label("Todavía no hay películas ni series de terror.", 15, MUTED));
    int columns = wide() ? 6 : 3;
    int width = gridWidth(columns);
    for (String[] section : Library.SECTIONS) {
      List<Library.Item> mine = new ArrayList<>();
      for (Object[] pair : horror) if (section[0].equals(pair[0])) mine.add((Library.Item) pair[1]);
      if (mine.isEmpty()) continue;
      heading(section[1], String.valueOf(mine.size()));
      LinearLayout r = null;
      for (int i = 0; i < mine.size(); i++) {
        if (i % columns == 0) { r = row(); r.setGravity(Gravity.TOP); list.addView(r); }
        r.addView(poster(mine.get(i), width));
      }
    }
  }

  /** The library's own entry for a «Continuar viendo» entry (section, item and episode), or null. */
  JSONObject libraryEntry(JSONObject entry) {
    if (library == null) return null;
    for (Library.Item item : library.items(entry.optString("section"))) {
      if (!item.id.equals(entry.optString("item"))) continue;
      String episode = entry.optString("episode");
      Library.Episode e = episode.isEmpty() ? null : item.episode(episode);
      if (!episode.isEmpty() && e == null) return null;
      return item.entry(entry.optString("section"), e);
    }
    return null;
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request != PLAY_LIBRARY) return;
    render();
    String key = result == RESULT_OK && data != null ? data.getStringExtra("ended") : null;
    if (key == null || library == null) return;
    for (String[] section : Library.SECTIONS)
      for (Library.Item item : library.items(section[0])) {
        Library.Episode e = item.series ? item.episode(key) : null;
        if (e == null) continue;
        Library.Episode next = item.next(e);
        if (next == null) return;
        Toast.makeText(this, "Siguiente: " + next.seasonLabel() + " · " + next.title(), Toast.LENGTH_SHORT).show();
        playEntry(item.entry(section[0], next), false);
        return;
      }
  }

  /** The first row of the home page: what this device left half watched, most recent first. */
  /** «Mi lista», «Recomendado para ti» and «Porque te gustó…» of the profile watching (as on the web). */
  void profileRows() {
    JSONObject data = Profiles.data();
    List<Library.Item> mine = new ArrayList<>();
    for (JSONObject entry : ProfileData.entries(data, "list")) {
      String[] at = library.locate(entry);
      if (at != null) mine.add(library.find(at[0], at[1]));
    }
    if (!mine.isEmpty()) posterRail("Mi lista", mine, wide() ? 140 : 108);
    List<JSONObject> seen = new ArrayList<>(ProfileData.entries(data, "watched"));
    seen.addAll(Library.Progress.list(Library.Progress.load(this)));
    List<Library.Item> picks = Library.recommended(library, seen, ProfileData.entries(data, "ratings"), 20);
    if (!picks.isEmpty()) posterRail("Recomendado para ti", picks, wide() ? 140 : 108);
    JSONObject liked = ProfileData.lastLiked(data);
    String[] at = liked == null ? null : library.locate(liked);
    if (at != null) {
      Library.Item item = library.find(at[0], at[1]);
      List<Library.Item> like = new ArrayList<>();
      for (Library.Item other : Library.similar(library, at[0], item, 12))
        if (ProfileData.rating(data, Library.page(at[0]), other.id) >= 0) like.add(other);
      if (!like.isEmpty()) posterRail("Porque te gustó «" + item.title + "»", like, wide() ? 140 : 108);
    }
  }

  void continueRow() {
    continueRow(null, "Continuar viendo");
  }

  /** What this device left half watched; only the titles of one section when `section` is not null. */
  void continueRow(String section, String title) {
    List<JSONObject> entries = new ArrayList<>();
    for (JSONObject entry : Library.Progress.list(Library.Progress.load(this)))
      if (section == null || section.equals(entry.optString("section"))) entries.add(entry);
    if (entries.isEmpty()) return;
    loadLibrary();
    heading(title, null);
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    h.setClipToPadding(false);
    LinearLayout r = row();
    r.setGravity(Gravity.TOP);
    for (JSONObject entry : entries) r.addView(continueCard(entry, wide() ? 260 : 200));
    h.addView(r);
    list.addView(h);
  }

  View continueCard(final JSONObject entry, int width) {
    LinearLayout card = new LinearLayout(this);
    card.setId(300000 + Math.abs(entry.optString("key").hashCode() % 800000));
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(dp(3), dp(3), dp(3), dp(8));
    card.setFocusable(true);
    card.setClickable(true);
    Ui.scaleOnFocus(card, 1.03f);
    FrameLayout art = new FrameLayout(this);
    art.setBackground(Ui.artBackground(this, Palette.hue(entry.optString("name")), 12));
    art.setForeground(Ui.focusOutline(this, 12));
    art.setClipToOutline(true);
    art.setDuplicateParentStateEnabled(true);
    TextView fallback = label(entry.optString("name"), 15, 0x66ffffff);
    fallback.setGravity(Gravity.CENTER);
    fallback.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    art.addView(fallback, new FrameLayout.LayoutParams(-1, -1));
    if (!entry.optString("image").isEmpty()) {
      ImageView picture = new ImageView(this);
      picture.setScaleType(ImageView.ScaleType.CENTER_CROP);
      art.addView(picture, new FrameLayout.LayoutParams(-1, -1));
      image(picture, entry.optString("image"));
    }
    ImageView play = new ImageView(this);
    play.setImageDrawable(Ui.icon(Ui.Icon.PLAY, Ui.FG, dp(22)));
    play.setScaleType(ImageView.ScaleType.CENTER);
    play.setBackground(Ui.shape(this, 0x99000000, 999, 0, 0));
    art.addView(play, new FrameLayout.LayoutParams(dp(46), dp(46), Gravity.CENTER));
    FrameLayout.LayoutParams barSize = new FrameLayout.LayoutParams(-1, dp(4), Gravity.BOTTOM);
    barSize.setMargins(dp(8), 0, dp(8), dp(8));
    art.addView(progressBar(entry), barSize);
    card.addView(art, new LinearLayout.LayoutParams(-1, Math.round(dp(width) * 9f / 16f)));
    TextView name = text(entry.optString("name"), 15);
    name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    wholeName(name);
    name.setPadding(dp(2), dp(8), dp(2), 0);
    card.addView(name, new LinearLayout.LayoutParams(-1, 0, 1));
    long left = entry.optLong("duration") - entry.optLong("position");
    String sub = entry.optString("sub") + (entry.optLong("duration") > 0 ? (entry.optString("sub").isEmpty() ? "" : " · ") + "quedan " + Math.max(1, Math.round(left / 60000f)) + " min" : "");
    TextView subtitle = label(sub, 12, Ui.MUTED);
    subtitle.setSingleLine(true);
    subtitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
    subtitle.setPadding(dp(2), 0, dp(2), 0);
    card.addView(subtitle);
    card.setContentDescription("Continuar " + entry.optString("title") + ". Mantén pulsado para quitarlo de Continuar viendo");
    card.setOnClickListener(v -> playEntry(entry, false));
    card.setOnLongClickListener(v -> {
      Library.Progress.save(this, Library.Progress.remove(Library.Progress.load(this), entry.optString("key")));
      Toast.makeText(this, "Quitado de Continuar viendo", Toast.LENGTH_SHORT).show();
      render();
      return true;
    });
    // As tall as the tallest card of its row, so the line under every name sits at the same height.
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -1);
    p.setMargins(dp(4), dp(4), dp(6), dp(6));
    card.setLayoutParams(p);
    return card;
  }

  void favoriteAction(View view, Catalog.Channel channel) {
    if (isLibraryHero(channel)) return; // Films and series are not channels to keep in favourites.
    view.setOnLongClickListener(v -> {
      if (favorites.contains(channel.channelId)) favorites.remove(channel.channelId);
      else favorites.add(channel.channelId);
      // The profile watching keeps its own favourites; without an account, this device's.
      if (Profiles.signedIn() && Profiles.active() != null) Profiles.toggleFavorite(this, channel.channelId);
      else getSharedPreferences("favorites", MODE_PRIVATE).edit().putStringSet("ids", new HashSet<>(favorites)).apply();
      boolean added = favorites.contains(channel.channelId);
      Toast.makeText(this, added ? "Añadido a favoritos" : "Quitado de favoritos", Toast.LENGTH_SHORT).show();
      if (v instanceof ViewGroup) {
        ViewGroup card = (ViewGroup) v;
        for (int i = 0; i < card.getChildCount(); i++) {
          View child = card.getChildAt(i);
          if (child instanceof TextView) { ((TextView) child).setText((added ? "★ " : "") + channel.name); break; }
        }
      }
      if (mode.equals("Favoritos")) {
        int id = v.getId();
        render();
        View replacement = root.findViewById(id);
        if (replacement != null) replacement.requestFocus();
        else { View first = list.getChildCount() > 1 ? list.getChildAt(1) : list; first.requestFocus(View.FOCUS_DOWN); }
      }
      return true;
    });
  }

  private boolean libraryAdminShown;

  /** Films, series and documentaries: for everyone while switched on; always for the administrator. */
  private boolean libraryShown(JSONObject catalog) {
    return Library.visible(catalog) || libraryAdmin();
  }

  private boolean libraryAdmin() {
    try {
      return SharedCatalog.administrator(SharedCatalog.auth(this).getCurrentUser());
    } catch (RuntimeException unavailable) {
      return false;
    }
  }
}
