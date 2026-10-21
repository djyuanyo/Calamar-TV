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
    Button admin = Ui.pill(this, "Administrar", Ui.Kind.GHOST, true);
    admin.setOnClickListener(v -> startActivity(new Intent(this, AdminActivity.class)));
    addButton(mast, admin);
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
    names.addAll(Catalog.groups(channels).keySet());
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
      if (!events.isEmpty()) { heading("Eventos", "Por fecha y hora"); carousel(events, events.size()); }
      for (Map.Entry<String, List<Catalog.Channel>> e : Catalog.groups(channels).entrySet()) {
        heading(e.getKey(), e.getValue().size() + " canales");
        carousel(e.getValue(), 40);
        if (e.getValue().size() > 40) {
          final String g = e.getKey();
          LinearLayout more = row();
          addButton(
              more,
              button(
                  "Ver los " + e.getValue().size() + " canales",
                  new View.OnClickListener() {
                    public void onClick(View v) {
                      mode = "Canales";
                      group = g;
                      home();
                    }
                  }));
          list.addView(more);
        }
      }
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
    heroItems = picks; heroHost = new FrameLayout(this); heroIndex = 0;
    list.addView(heroHost, heroParams()); showHero(0, false);
  }

  void showHero(int index, boolean user) {
    if (heroHost == null || heroItems.isEmpty()) return;
    boolean focused = heroHost.hasFocus();
    heroIndex = index; heroHost.removeAllViews();
    View next = heroView(heroItems, index); heroHost.addView(next, new FrameLayout.LayoutParams(-1, -1));
    next.setAlpha(0f); next.animate().alpha(1f).setDuration(350).start();
    if (focused || user) { View control = next.findViewWithTag("hero-watch"); if (control != null) control.requestFocus(); }
    handler.removeCallbacks(heroAdvance);
    if (resumed && heroItems.size() > 1) handler.postDelayed(heroAdvance, 5000);
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
    TextView pill = Ui.livePill(this, "EN DIRECTO", 11);
    if (c.event) { pill.setText(SportsCatalog.stateName(c.status)); content.addView(pill, new LinearLayout.LayoutParams(-2, -2)); }
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
    Button all = Ui.pill(this, "Todos los canales", Ui.Kind.SURFACE, false);
    all.setOnClickListener(
        new View.OnClickListener() {
          public void onClick(View v) {
            mode = "Canales";
            group = "Todos";
            home();
          }
        });
    actions.addView(all, new LinearLayout.LayoutParams(-2, dp(48)));
    content.addView(actions);
    frame.addView(content, new FrameLayout.LayoutParams(-1, -1));

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
    art.setBackground(Ui.artBackground(this, Palette.hue(c.name), 12));
    art.setDuplicateParentStateEnabled(true);
    int artHeight = Math.round(dp(width) * 9f / 16f);
    if (c.event) {
      ImageView cover = new ImageView(this);
      cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
      art.addView(cover, new FrameLayout.LayoutParams(-1, -1));
      image(cover, c.cover);
    }
    int logoSize = Math.round(artHeight * 0.86f);
    Ui.LogoView logo = new Ui.LogoView(this, c.name, 10);
    art.addView(logo, new FrameLayout.LayoutParams(logoSize, logoSize, Gravity.CENTER));
    image(logo, c.logo);
    if (c.event) logo.setVisibility(View.GONE);
    TextView badge = c.playable() ? Ui.livePill(this, "EN DIRECTO", 9) : Ui.tag(this, "SU WEB", 9);
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
    bp.setMargins(dp(8), dp(8), 0, 0);
    if (c.event) { badge.setText(SportsCatalog.stateName(c.status)); art.addView(badge, bp); }
    card.addView(art, new LinearLayout.LayoutParams(-1, artHeight));

    TextView name = text((favorites.contains(c.channelId) ? "★ " : "") + c.name, 15);
    name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    name.setSingleLine(true);
    name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    name.setPadding(dp(2), dp(8), dp(2), 0);
    card.addView(name);
    TextView sub = label(c.event ? c.meta : c.region.isEmpty() ? c.group : c.region, 12, Ui.MUTED);
    sub.setSingleLine(true);
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
    for (Map.Entry<String, List<Catalog.Channel>> e : Catalog.groups(channels).entrySet()) {
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
    startActivity(intent);
  }

  protected void onPause() {
    super.onPause();
    resumed = false; handler.removeCallbacks(heroAdvance);
    handler.removeCallbacks(refresh);
    if (sharedListener != null) {
      sharedListener.remove();
      sharedListener = null;
    }
  }

  protected void onResume() {
    super.onResume();
    resumed = true;
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
