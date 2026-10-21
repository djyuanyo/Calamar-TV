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
import org.json.*;

/** Calamar TV: free-to-air TDT channels plus the administrator's channels, shared with the web. */
public class MainActivity extends Activity {
  /** Published by GitHub Pages from data/ in this repository (see .github/workflows/web.yml). */
  static final String CATALOG_BASE = "https://djyuanyo.github.io/Calamar-TV/data/";

  final int FG = Ui.FG, MUTED = Ui.MUTED;
  LinearLayout root, list, filters;
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
      new LruCache<String, Bitmap>(12 * 1024 * 1024) {
        protected int sizeOf(String k, Bitmap b) {
          return b.getByteCount();
        }
      };
  FrameLayout heroHost;
  List<Catalog.Channel> heroItems = Collections.emptyList();
  int heroIndex;
  boolean resumed;
  final Runnable heroAdvance = new Runnable() { public void run() {
    if (resumed && heroHost != null && heroItems.size() > 1) { showHero((heroIndex + 1) % heroItems.size(), false); }
  }};
  final Handler handler = new Handler(Looper.getMainLooper());
  final Runnable refresh =
      new Runnable() {
        public void run() {
          load();
          handler.postDelayed(this, 10 * 60000);
        }
      };

  public void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
    restore();
    favorites.addAll(getSharedPreferences("favorites", MODE_PRIVATE).getStringSet("ids", Collections.emptySet()));
    home();
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
        if (isFinishing()) return;
        if (result != null) {
          tdt = result[0];
          if (!sharedAvailable) custom = result[1];
          channels = Catalog.merge(tdt, custom);
          updatedAt = System.currentTimeMillis();
          origin = "En línea";
        }
        loadError = error == null ? "" : error + " · Se muestra el último catálogo disponible.";
        View focused = getCurrentFocus();
        int focusId = focused != null ? focused.getId() : View.NO_ID;
        renderFilters();
        render();
        if (focusId != View.NO_ID && root != null) {
          View replacement = root.findViewById(focusId);
          if (replacement != null) replacement.requestFocus();
        }
      }
    }.execute();
  }

  String status() {
    int playable = 0;
    for (Catalog.Channel c : channels) if (c.playable()) playable++;
    SimpleDateFormat stamp = new SimpleDateFormat("dd/MM HH:mm", Locale.getDefault());
    return origin
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
    // Icon only (account silhouette); the name stays for screen readers and as a tooltip.
    ImageButton admin = new ImageButton(this);
    admin.setImageDrawable(Ui.icon(Ui.Icon.ADMIN, Ui.MUTED, dp(22)));
    admin.setBackground(Ui.focusFill(this, 0, 0x22ffffff, Ui.ACC, 999, 0));
    admin.setContentDescription("Administración");
    if (android.os.Build.VERSION.SDK_INT >= 26) admin.setTooltipText("Administración");
    admin.setOnClickListener(v -> startActivity(new Intent(this, AdminActivity.class)));
    LinearLayout.LayoutParams adminSize = new LinearLayout.LayoutParams(dp(44), dp(44));
    adminSize.setMargins(dp(4), dp(4), dp(4), dp(4));
    mast.addView(admin, adminSize);
    root.addView(mast);
    EditText search = new EditText(this);
    search.setSingleLine(true);
    search.setTextColor(Ui.FG);
    search.setHintTextColor(Ui.MUTED);
    search.setTextSize(16);
    search.setHint("Buscar canales y eventos");
    search.setContentDescription("Buscar canales y eventos");
    search.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
    search.setBackground(Ui.focusFill(this, Ui.SURFACE, 0x33ffffff, Ui.ACC, 24, 0));
    search.setPadding(dp(18), dp(10), dp(18), dp(10));
    search.setText(query);
    LinearLayout.LayoutParams searchParams = new LinearLayout.LayoutParams(-1, dp(48));
    searchParams.setMargins(0, dp(6), 0, dp(8));
    root.addView(search, searchParams);
    search.addTextChangedListener(new android.text.TextWatcher() {
      public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
      public void onTextChanged(CharSequence s, int start, int before, int count) { query = s.toString(); render(); }
      public void afterTextChanged(android.text.Editable s) {}
    });

    LinearLayout nav = row();
    for (final String m : new String[] {"Inicio", "Canales", "Favoritos"}) {
      nav.addView(
          tab(
              m,
              mode.equals(m),
              new View.OnClickListener() {
                public void onClick(View v) {
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
    t.setBackground(Ui.focusFill(this, Color.TRANSPARENT, 0x1fffffff, Ui.ACC, 8, 0));
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
    if (!mode.equals("Canales")) return;
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
    image(logo, url);
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
    list.removeAllViews();
    message.setText(status());
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
      if (found.isEmpty()) list.addView(label("Sin resultados", 15, Ui.MUTED));
      return;
    }
    if (channels.isEmpty()) {
      heading("Catálogo no disponible", null);
      list.addView(label("Pulsa Actualizar para volver a consultarlo.", 15, MUTED));
      return;
    }
    if (mode.equals("Canales")) {
      grid();
    } else {
      List<Catalog.Channel> featured = Catalog.highlights(channels, custom);
      List<Catalog.Channel> events = Catalog.events(channels, custom);
      if (!featured.isEmpty()) hero(featured);
      // Only events on the home page: one row per league, each in date order.
      for (Catalog.EventRow row : Catalog.eventRows(events, custom)) {
        heading(row.name, row.events.size() == 1 ? "1 evento" : row.events.size() + " eventos");
        if (!row.logo.isEmpty()) leagueLogo(row.logo);
        carousel(row.events, row.events.size());
      }
      if (events.isEmpty()) list.addView(label("Todavía no hay eventos. Abre Canales para ver todos los canales.", 15, MUTED));
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
    next.setAlpha(0f); next.animate().alpha(1f).setDuration(350).start();
    if (focused || user) { View control = next.findViewWithTag("hero-watch"); if (control != null) control.requestFocus(); }
    restartHeroTimer();
  }

  void restartHeroTimer() {
    handler.removeCallbacks(heroAdvance);
    if (resumed && heroItems.size() > 1) handler.postDelayed(heroAdvance, 5000);
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

    if (c.event) {
      ImageView cover = new ImageView(this);
      cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
      frame.addView(cover, new FrameLayout.LayoutParams(-1, -1));
      image(cover, c.cover);
    }
    int size = wide() ? 250 : 150;
    Ui.LogoView logo = new Ui.LogoView(this, c.name, 20);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(size), dp(size));
    lp.gravity = wide() ? (Gravity.END | Gravity.CENTER_VERTICAL) : (Gravity.END | Gravity.TOP);
    lp.setMargins(0, wide() ? 0 : dp(18), dp(wide() ? 48 : 18), 0);
    frame.addView(logo, lp);
    image(logo, c.logo);
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
    if (c.event) content.addView(eventBadge(c, 11), new LinearLayout.LayoutParams(-2, -2));
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
    if (!c.region.isEmpty()) line.append(" · ").append(c.region);
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
  final Map<String,MatchScores.Result> matchResults=new HashMap<>();
  boolean scoresBusy;
  View multiPicker;
  final Runnable scoreRefresh=new Runnable(){public void run(){
    if(!resumed)return;
    if(!scoresBusy){
      Set<String> ids=new HashSet<>(); collectScoreIds(root,ids); collectScoreIds(multiPicker,ids);
      if(!ids.isEmpty()) { scoresBusy=true; new Thread(() -> {
        Map<String,MatchScores.Result> results=new HashMap<>();
        for(String id:ids)try{results.put(id,MatchScores.fetch(id));}catch(Exception ignored){results.put(id,null);}
        runOnUiThread(() -> {scoresBusy=false;matchResults.putAll(results);if(resumed){updateScores(root);updateScores(multiPicker);} });
      }).start(); }
    }
    handler.removeCallbacks(this);handler.postDelayed(this,30000);
  }};
  void collectScoreIds(View view,Set<String> ids){
    if(view==null)return;
    if(view instanceof TextView && view.getTag() instanceof Catalog.Channel){Catalog.Channel c=(Catalog.Channel)view.getTag();if(!c.matchId.isEmpty())ids.add(c.matchId);}
    if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)collectScoreIds(group.getChildAt(i),ids);}
  }
  void updateScores(View view){
    if(view==null)return;
    if(view instanceof TextView && view.getTag() instanceof Catalog.Channel){Catalog.Channel c=(Catalog.Channel)view.getTag();MatchScores.Result score=matchResults.get(c.matchId);((TextView)view).setText(score==null?"Marcador no disponible":score.text);view.setContentDescription(((TextView)view).getText()+". Resultados: ESPN");}
    if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)updateScores(group.getChildAt(i));}
  }
  TextView eventBadge(Catalog.Channel c, float sp) {
    MatchScores.Result score=matchResults.get(c.matchId);
    String label=c.matchUrl.isEmpty()?SportsCatalog.label(c.status,c.startAt,System.currentTimeMillis()):score==null?"Consultando marcador…":score.text;
    TextView badge=SportsCatalog.LIVE.equals(label)?Ui.livePill(this,label.toUpperCase(Locale.ROOT),sp):Ui.tag(this,label,sp);
    if(!c.matchUrl.isEmpty()&&!c.matchId.isEmpty()){badge.setTag(c);badge.setContentDescription(label+". Resultados: ESPN");handler.removeCallbacks(scoreRefresh);handler.postDelayed(scoreRefresh,300);}
    return badge;
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
      ImageView cover = new ImageView(this);
      cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
      art.addView(cover, new FrameLayout.LayoutParams(-1, -1));
      image(cover, c.cover);
      // The cover covers the background's border, so the focus border goes on top, as on channels.
      art.setForeground(Ui.focusOutline(this, 12));
      art.setClipToOutline(true);
    }
    // The logo fills the card as much as it can, with a small margin from the rounded corners.
    Ui.LogoView logo = new Ui.LogoView(this, c.name, 8);
    FrameLayout.LayoutParams logoSize = new FrameLayout.LayoutParams(-1, -1);
    logoSize.setMargins(dp(6), dp(6), dp(6), dp(6));
    art.addView(logo, logoSize);
    image(logo, c.logo);
    if (c.event) logo.setVisibility(View.GONE);
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
    bp.setMargins(dp(8), dp(8), 0, 0);
    if (c.event) art.addView(eventBadge(c, 9), bp);
    card.addView(art, new LinearLayout.LayoutParams(-1, artHeight));

    TextView name = text((favorites.contains(c.channelId) ? "★ " : "") + c.name, 15);
    name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    name.setSingleLine(true);
    name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    name.setPadding(dp(2), dp(8), dp(2), 0);
    card.addView(name);
    TextView sub = label(c.event ? c.meta : c.region.isEmpty() ? c.group : c.region, 12, Ui.MUTED);
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
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -2);
    p.setMargins(dp(4), dp(4), dp(6), dp(6));
    card.setLayoutParams(p);
    return card;
  }

  void carousel(List<Catalog.Channel> a, int limit) {
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    h.setClipToPadding(false);
    LinearLayout r = row();
    r.setGravity(Gravity.TOP);
    for (int i = 0; i < Math.min(a.size(), limit); i++)
      r.addView(card(a.get(i), wide() ? 230 : 172));
    h.addView(r);
    list.addView(h);
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
    EditText search=new EditText(this);search.setSingleLine(true);search.setHint("Buscar eventos o canales");search.setTextColor(Ui.FG);search.setHintTextColor(Ui.MUTED);panel.addView(search,new LinearLayout.LayoutParams(-1,-2));
    TextView count=text("Elige de 2 a "+MultiScreen.MAX,14);panel.addView(count);
    ScrollView scroll=new ScrollView(this);LinearLayout grid=new LinearLayout(this);grid.setOrientation(LinearLayout.VERTICAL);scroll.addView(grid);panel.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
    Button watch=new Button(this);watch.setText("Ver a la vez");watch.setAllCaps(false);watch.setEnabled(false);panel.addView(watch);
    AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Multipantalla").setView(panel).setNegativeButton("Cancelar",null).create();
    final Map<Catalog.Channel,TextView> marks=new HashMap<>();
    Runnable sync=() -> {count.setText(selected.size()+" / "+MultiScreen.MAX+" seleccionados");watch.setText("Ver "+selected.size()+" a la vez");watch.setEnabled(selected.size()>=2);
      for(Map.Entry<Catalog.Channel,TextView> mark:marks.entrySet()){int index=selected.indexOf(mark.getKey());mark.getValue().setText(index<0?"+":String.valueOf(index+1));View tile=(View)mark.getValue().getParent();tile.setSelected(index>=0);tile.setContentDescription(mark.getKey().name+(index<0?", añadir":", seleccionado "+(index+1)));}
    };
    Runnable draw=() -> {
      grid.removeAllViews();marks.clear();String q=search.getText().toString().trim().toLowerCase(Locale.ROOT);
      int available=(int)(getResources().getDisplayMetrics().widthPixels/getResources().getDisplayMetrics().density)-64;
      int columns=available>=800?4:available>=540?3:2,width=Math.max(100,available/columns-8),column=0;LinearLayout row=null;
      for(Catalog.Channel c:options){if(!(c.name+" "+c.meta+" "+c.group).toLowerCase(Locale.ROOT).contains(q))continue;
        if(column++%columns==0){row=new LinearLayout(this);grid.addView(row,new LinearLayout.LayoutParams(-1,-2));}
        FrameLayout tile=new FrameLayout(this);View content=card(c,width);content.setFocusable(false);content.setClickable(false);content.setLongClickable(false);content.setOnLongClickListener(null);tile.addView(content,new FrameLayout.LayoutParams(-1,-2));
        TextView mark=Ui.tag(this,"+",16);FrameLayout.LayoutParams mp=new FrameLayout.LayoutParams(-2,-2,Gravity.TOP|Gravity.END);mp.setMargins(0,dp(8),dp(8),0);tile.addView(mark,mp);marks.put(c,mark);
        tile.setBackground(Ui.artBackground(this,Palette.hue(c.name),12));tile.setFocusable(true);tile.setClickable(true);Ui.scaleOnFocus(tile,1.03f);
        tile.setOnClickListener(v -> {if(selected.contains(c))selected.remove(c);else if(selected.size()<MultiScreen.MAX)selected.add(c);else Toast.makeText(this,"Máximo "+MultiScreen.MAX+" a la vez",Toast.LENGTH_SHORT).show();sync.run();});
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(dp(width),-2);lp.setMargins(dp(4),dp(4),dp(4),dp(8));row.addView(tile,lp);
      }
      if(marks.isEmpty())grid.addView(text("Sin resultados",16));sync.run();
    };
    search.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){draw.run();}public void afterTextChanged(android.text.Editable e){}});
    watch.setOnClickListener(v -> {
      if(selected.size()<2)return;
      ArrayList<String> titles=new ArrayList<>(),streams=new ArrayList<>();for(Catalog.Channel c:selected){titles.add(c.name);streams.add(android.text.TextUtils.join("\n",c.streams));}
      dialog.dismiss();startActivity(new Intent(this,MultiPlayerActivity.class).putStringArrayListExtra(MultiPlayerActivity.TITLES,titles).putStringArrayListExtra(MultiPlayerActivity.STREAMS,streams));
    });
    multiPicker=panel;dialog.setOnDismissListener(d -> multiPicker=null);dialog.show();
    dialog.getWindow().setBackgroundDrawableResource(android.R.color.black);dialog.getWindow().setLayout(-1,(int)(getResources().getDisplayMetrics().heightPixels*.9f));
    dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);draw.run();
  }

  /** Channels whose links are videos the player opens directly (not pages resolved in the full player). */
  boolean directMedia(Catalog.Channel c) {
    return c.playable() && !UserChannels.isPage(c.streams.get(0));
  }

  void open(Catalog.Channel c) {
    if (!c.playable()) {
      try {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(c.web)));
      } catch (android.content.ActivityNotFoundException missing) {
        Toast.makeText(this, "No hay navegador instalado", Toast.LENGTH_LONG).show();
      }
      return;
    }
    Intent intent = new Intent(this, NativePlayerActivity.class);
    String first = c.streams.get(0);
    if (UserChannels.isPage(first)) intent.putExtra("page_url", first);
    else intent.putStringArrayListExtra("media_urls", new ArrayList<>(c.streams));
    intent.putExtra("title", c.name);
    if(c.event && !c.matchId.isEmpty())intent.putExtra("match_id",c.matchId);
    // Events can be shared from the player with their preview link (cover and name in WhatsApp).
    if (c.event) intent.putExtra("share_url", SportsCatalog.link(SportsCatalog.slugs(custom).get(c.id)));
    startActivity(intent);
  }

  protected void onPause() {
    super.onPause();
    resumed = false; handler.removeCallbacks(heroAdvance); handler.removeCallbacks(scoreRefresh);
    handler.removeCallbacks(refresh);
    if (sharedListener != null) {
      sharedListener.remove();
      sharedListener = null;
    }
  }

  protected void onResume() {
    super.onResume();
    resumed = true; handler.removeCallbacks(scoreRefresh); handler.post(scoreRefresh);
    if (heroHost != null && heroItems.size() > 1) handler.postDelayed(heroAdvance, 5000);
    handler.removeCallbacks(refresh);
    handler.post(refresh);
    sharedListener =
        SharedCatalog.document(this)
            .addSnapshotListener(
                (snapshot, error) -> {
                  if (isFinishing()
                      || error != null
                      || snapshot == null
                      || !snapshot.exists()
                      || snapshot.getMetadata().hasPendingWrites()) return;
                  try {
                    JSONObject next = SharedCatalog.decode(snapshot);
                    if (sharedAvailable && next.toString().equals(custom.toString())) return;
                    custom = next;
                    sharedAvailable = true;
                    SharedCatalog.cache(this, custom);
                    channels = Catalog.merge(tdt, custom);
                    renderFilters();
                    render();
                  } catch (Exception ignored) {
                  }
                });
  }

  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
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
    if (url != null && url.startsWith("data:image/")) {
      try {
        byte[] bytes = android.util.Base64.decode(url.substring(url.indexOf(',') + 1), android.util.Base64.DEFAULT);
        view.setImageBitmap(BitmapFactory.decodeByteArray(bytes, 0, bytes.length));
      } catch (IllegalArgumentException ignored) {}
      return;
    }
    if (url == null || !url.startsWith("https://")) return;
    Bitmap cached = images.get(url);
    if (cached != null) {
      view.setImageBitmap(cached);
      return;
    }
    view.setTag(url);
    new AsyncTask<Void, Void, Bitmap>() {
      protected Bitmap doInBackground(Void... v) {
        try {
          HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
          c.setConnectTimeout(6000);
          c.setReadTimeout(7000);
          try {
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
              if (out.size() + n > 5 * 1024 * 1024) return null;
              out.write(buf, 0, n);
            }
            in.close();
            byte[] data = out.toByteArray();
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(data, 0, data.length, o);
            o.inSampleSize = 1;
            while (o.outWidth / o.inSampleSize > 1000 || o.outHeight / o.inSampleSize > 800)
              o.inSampleSize *= 2;
            o.inJustDecodeBounds = false;
            return BitmapFactory.decodeByteArray(data, 0, data.length, o);
          } finally {
            c.disconnect();
          }
        } catch (Exception e) {
          return null;
        }
      }

      protected void onPostExecute(Bitmap b) {
        if (b != null) {
          images.put(url, b);
          if (url.equals(view.getTag()) && !isFinishing()) view.setImageBitmap(b);
        }
      }
    }.executeOnExecutor(AsyncTask.THREAD_POOL_EXECUTOR);
  }


  boolean matches(String name) {
    return normalizeSearch(name).contains(normalizeSearch(query.trim()));
  }

  String normalizeSearch(String text) {
    return java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
  }

  void channelGrid(List<Catalog.Channel> items) {
    int cols = wide() ? 4 : 2;
    LinearLayout r = null;
    for (int i = 0; i < items.size(); i++) {
      if (i % cols == 0) { r = row(); r.setGravity(Gravity.TOP); list.addView(r); }
      r.addView(card(items.get(i), gridWidth(cols)));
    }
  }

  void favoriteAction(View view, Catalog.Channel channel) {
    view.setOnLongClickListener(v -> {
      if (favorites.contains(channel.channelId)) favorites.remove(channel.channelId);
      else favorites.add(channel.channelId);
      getSharedPreferences("favorites", MODE_PRIVATE).edit().putStringSet("ids", new HashSet<>(favorites)).apply();
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
}
