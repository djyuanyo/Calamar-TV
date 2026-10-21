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
  JSONArray userChannels = new JSONArray();
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
    restore();
    userChannels = UserChannels.load(userChannelFile());
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

    LinearLayout nav = row();
    for (final String m : new String[] {"Inicio", "Canales", "Fútbol", "Mis canales"}) {
      nav.addView(
          tab(
              m,
              mode.equals(m),
              new View.OnClickListener() {
                public void onClick(View v) {
                  if ("Fútbol".equals(m)) {
                    startActivity(new Intent(MainActivity.this, FootballActivity.class));
                  } else {
                    mode = m;
                    home();
                  }
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
    list.removeAllViews();
    message.setText(status());
    if (mode.equals("Mis canales")) {
      myChannels();
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
      List<Catalog.Channel> featured = Catalog.featured(channels, custom, 8);
      if (!featured.isEmpty()) hero(featured);
      if (featured.size() > 1) {
        heading("Destacados", null);
        carousel(featured.subList(1, featured.size()), 40);
      }
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
    list.addView(heroView(picks, 0), heroParams());
  }

  View heroView(final List<Catalog.Channel> picks, final int index) {
    final Catalog.Channel c = picks.get(index);
    final FrameLayout frame = new FrameLayout(this);
    frame.setBackground(Ui.heroBackground(this, Palette.hue(c.name)));
    frame.setClipToOutline(true);

    int size = wide() ? 190 : 96;
    Ui.LogoView logo = new Ui.LogoView(this, c.name, 20);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(size), dp(size));
    lp.gravity = wide() ? (Gravity.END | Gravity.CENTER_VERTICAL) : (Gravity.END | Gravity.TOP);
    lp.setMargins(0, wide() ? 0 : dp(18), dp(wide() ? 48 : 18), 0);
    frame.addView(logo, lp);
    image(logo, c.logo);

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
    content.addView(pill, new LinearLayout.LayoutParams(-2, -2));
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
    StringBuilder line = new StringBuilder(c.group);
    if (!c.region.isEmpty()) line.append(" · ").append(c.region);
    line.append(" · ").append(c.own ? "Canal de Calamar TV" : "Emisión oficial en abierto");
    meta.setText(line);
    meta.setTextColor(0xffd6dbe2);
    meta.setTextSize(14);
    meta.setPadding(0, dp(4), 0, dp(14));
    content.addView(meta);
    LinearLayout actions = row();
    Button watch = Ui.pill(this, "Ver ahora", Ui.Kind.ACCENT, false);
    watch.setCompoundDrawablesWithIntrinsicBounds(Ui.icon(Ui.Icon.PLAY, Ui.BG, dp(18)), null, null, null);
    watch.setCompoundDrawablePadding(dp(8));
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
      for (int i = 0; i < Math.min(picks.size(), 6); i++) {
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
        thumb.setOnClickListener(
            new View.OnClickListener() {
              public void onClick(View v) {
                int at = list.indexOfChild(frame);
                if (at < 0) return;
                list.removeViewAt(at);
                View next = heroView(picks, pick);
                list.addView(next, at, heroParams());
                View focus = next.findViewWithTag("pick" + pick);
                if (focus != null) focus.requestFocus();
              }
            });
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(dp(68), dp(44));
        tp.setMargins(dp(4), 0, dp(4), 0);
        row.addView(thumb, tp);
      }
      FrameLayout.LayoutParams rp =
          new FrameLayout.LayoutParams(-2, -2, Gravity.END | Gravity.BOTTOM);
      rp.setMargins(0, 0, dp(40), dp(18));
      frame.addView(row, rp);
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
    int logoSize = Math.round(artHeight * 0.58f);
    Ui.LogoView logo = new Ui.LogoView(this, c.name, 10);
    art.addView(logo, new FrameLayout.LayoutParams(logoSize, logoSize, Gravity.CENTER));
    image(logo, c.logo);
    TextView badge = c.playable() ? Ui.livePill(this, "EN DIRECTO", 9) : Ui.tag(this, "SU WEB", 9);
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
    bp.setMargins(dp(8), dp(8), 0, 0);
    art.addView(badge, bp);
    card.addView(art, new LinearLayout.LayoutParams(-1, artHeight));

    TextView name = text(c.name, 15);
    name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    name.setSingleLine(true);
    name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    name.setPadding(dp(2), dp(8), dp(2), 0);
    card.addView(name);
    TextView sub = label(c.region.isEmpty() ? c.group : c.region, 12, Ui.MUTED);
    sub.setSingleLine(true);
    sub.setEllipsize(android.text.TextUtils.TruncateAt.END);
    sub.setPadding(dp(2), 0, dp(2), 0);
    card.addView(sub);
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
    handler.removeCallbacks(refresh);
    if (sharedListener != null) {
      sharedListener.remove();
      sharedListener = null;
    }
  }

  protected void onResume() {
    super.onResume();
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

  File userChannelFile() {
    return new File(getFilesDir(), "user-channels.json");
  }

  void myChannels() {
    heading("Mis canales", userChannels.length() + " canales");
    TextView help =
        label(
            "Añade enlaces de vídeo (.ts, .m3u8, .mpd, .mp4) o la página https de un reproductor:"
                + " la app obtiene su fuente actual y la renueva al caducar. Se guardan solo en"
                + " este dispositivo. Mantén pulsado un canal para editarlo o eliminarlo.",
            12,
            Ui.MUTED);
    help.setPadding(dp(4), 0, dp(4), dp(6));
    list.addView(help);
    LinearLayout actions = row();
    Button add = Ui.pill(this, "+  Añadir canal", Ui.Kind.ACCENT, false);
    add.setOnClickListener(
        new View.OnClickListener() {
          public void onClick(View v) {
            editChannel(-1);
          }
        });
    LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(-2, dp(46));
    ap.setMargins(dp(4), dp(4), dp(4), dp(8));
    actions.addView(add, ap);
    list.addView(actions);
    int cols = wide() ? 4 : 2, width = gridWidth(cols);
    LinearLayout r = null;
    for (int i = 0; i < userChannels.length(); i++) {
      final int index = i;
      final JSONObject channel = userChannels.optJSONObject(i);
      if (channel == null) continue;
      if (i % cols == 0) {
        r = row();
        r.setGravity(Gravity.TOP);
        list.addView(r);
      }
      LinearLayout c = new LinearLayout(this);
      c.setId(300000 + i);
      c.setOrientation(LinearLayout.VERTICAL);
      c.setPadding(dp(3), dp(3), dp(3), dp(8));
      c.setFocusable(true);
      c.setClickable(true);
      Ui.scaleOnFocus(c, 1.03f);
      FrameLayout art = new FrameLayout(this);
      art.setBackground(Ui.artBackground(this, Palette.hue(channel.optString("name")), 12));
      art.setDuplicateParentStateEnabled(true);
      ImageView play = new ImageView(this);
      int artHeight = Math.round(dp(width) * 9f / 16f);
      int playSize = Math.round(artHeight * 0.4f);
      play.setImageDrawable(Ui.icon(Ui.Icon.PLAY, Ui.ACC, playSize));
      art.addView(play, new FrameLayout.LayoutParams(playSize, playSize, Gravity.CENTER));
      c.addView(art, new LinearLayout.LayoutParams(-1, artHeight));
      TextView name = text(channel.optString("name"), 15);
      name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      name.setSingleLine(true);
      name.setEllipsize(android.text.TextUtils.TruncateAt.END);
      name.setPadding(dp(2), dp(8), dp(2), 0);
      c.addView(name);
      TextView host = label(Uri.parse(channel.optString("url")).getHost(), 12, Ui.MUTED);
      host.setSingleLine(true);
      host.setEllipsize(android.text.TextUtils.TruncateAt.END);
      host.setPadding(dp(2), 0, dp(2), 0);
      c.addView(host);
      c.setOnClickListener(
          new View.OnClickListener() {
            public void onClick(View v) {
              playDirect(channel.optString("name"), channel.optString("url"));
            }
          });
      c.setOnLongClickListener(
          new View.OnLongClickListener() {
            public boolean onLongClick(View v) {
              channelOptions(index);
              return true;
            }
          });
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -2);
      p.setMargins(dp(4), dp(4), dp(6), dp(6));
      r.addView(c, p);
    }
  }

  void channelOptions(final int index) {
    JSONObject channel = userChannels.optJSONObject(index);
    if (channel == null) return;
    new AlertDialog.Builder(this)
        .setTitle(channel.optString("name"))
        .setItems(
            new String[] {"Reproducir", "Editar", "Eliminar"},
            new android.content.DialogInterface.OnClickListener() {
              public void onClick(android.content.DialogInterface d, int n) {
                JSONObject current = userChannels.optJSONObject(index);
                if (current == null) return;
                if (n == 0) playDirect(current.optString("name"), current.optString("url"));
                else if (n == 1) editChannel(index);
                else confirmRemove(index);
              }
            })
        .setNegativeButton("Volver", null)
        .show();
  }

  void confirmRemove(final int index) {
    JSONObject channel = userChannels.optJSONObject(index);
    if (channel == null) return;
    new AlertDialog.Builder(this)
        .setMessage("¿Eliminar " + channel.optString("name") + "?")
        .setPositiveButton(
            "Eliminar",
            new android.content.DialogInterface.OnClickListener() {
              public void onClick(android.content.DialogInterface d, int n) {
                storeChannels(UserChannels.remove(userChannels, index));
              }
            })
        .setNegativeButton("Cancelar", null)
        .show();
  }

  void editChannel(final int index) {
    JSONObject existing = index >= 0 ? userChannels.optJSONObject(index) : null;
    LinearLayout form = new LinearLayout(this);
    form.setOrientation(LinearLayout.VERTICAL);
    form.setPadding(dp(20), dp(8), dp(20), 0);
    final EditText name = new EditText(this);
    name.setHint("Nombre del canal");
    name.setSingleLine(true);
    name.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
    final EditText url = new EditText(this);
    url.setHint("http://servidor:puerto/ruta/canal.ts");
    url.setSingleLine(true);
    url.setInputType(
        android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
    if (existing != null) {
      name.setText(existing.optString("name"));
      url.setText(existing.optString("url"));
    }
    form.addView(name);
    form.addView(url);
    final AlertDialog dialog =
        new AlertDialog.Builder(this)
            .setTitle(existing == null ? "Añadir canal" : "Editar canal")
            .setView(form)
            .setPositiveButton("Guardar", null)
            .setNegativeButton("Cancelar", null)
            .create();
    dialog.setOnShowListener(
        new android.content.DialogInterface.OnShowListener() {
          public void onShow(android.content.DialogInterface d) {
            dialog
                .getButton(AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(
                    new View.OnClickListener() {
                      public void onClick(View v) {
                        String address = url.getText().toString();
                        if (UserChannels.normalize(address) == null) {
                          url.setError("Introduce un enlace que empiece por http:// o https://");
                          return;
                        }
                        try {
                          String title = name.getText().toString();
                          storeChannels(
                              index < 0
                                  ? UserChannels.add(userChannels, title, address)
                                  : UserChannels.replace(userChannels, index, title, address));
                          dialog.dismiss();
                        } catch (JSONException invalid) {
                          url.setError("Enlace no válido");
                        }
                      }
                    });
          }
        });
    dialog.show();
  }

  void storeChannels(JSONArray updated) {
    try {
      UserChannels.save(userChannelFile(), updated);
      userChannels = updated;
    } catch (IOException e) {
      Toast.makeText(this, "No se pudieron guardar los canales", Toast.LENGTH_LONG).show();
    }
    render();
  }

  void playDirect(String name, String address) {
    if (UserChannels.normalize(address) == null) {
      Toast.makeText(this, "Enlace no válido", Toast.LENGTH_LONG).show();
      return;
    }
    android.content.Intent intent = new android.content.Intent(this, NativePlayerActivity.class);
    // A player page is re-read for a current source and renewed before its token expires.
    intent.putExtra(UserChannels.isPage(address) ? "page_url" : "media_url", address.trim());
    intent.putExtra("title", name);
    startActivity(intent);
  }
}
