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

  final int BG = 0xff0b0d10, FG = 0xfff5f5f5, ACC = 0xffd6ff00, MUTED = 0xffa4acb7;
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

  void home() {
    root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setPadding(dp(wide() ? 28 : 12), dp(12), dp(wide() ? 28 : 12), 0);
    root.setBackgroundColor(BG);
    root.setFitsSystemWindows(true);
    setContentView(root);
    getWindow().setStatusBarColor(BG);
    getWindow().setNavigationBarColor(BG);
    LinearLayout mast = row();
    TextView brand = text("CALAMAR / TV", wide() ? 23 : 21);
    brand.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    mast.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
    TextView tag = label("TDT EN DIRECTO", 11, ACC);
    tag.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    mast.addView(tag);
    root.addView(mast);
    LinearLayout nav = row();
    for (final String m : new String[] {"Inicio", "Canales", "Mis canales"}) {
      Button tab =
          button(
              m,
              new View.OnClickListener() {
                public void onClick(View v) {
                  mode = m;
                  home();
                }
              });
      if (mode.equals(m)) accent(tab);
      addButton(nav, tab);
    }
    addButton(
        nav,
        button(
            "↻ Actualizar",
            new View.OnClickListener() {
              public void onClick(View v) {
                load();
              }
            }));
    addButton(
        nav, button("Administrar", v -> startActivity(new Intent(this, AdminActivity.class))));
    HorizontalScrollView n = new HorizontalScrollView(this);
    n.setHorizontalScrollBarEnabled(false);
    n.addView(nav);
    root.addView(n);
    filters = row();
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    h.addView(filters);
    root.addView(h);
    message = label("", 11, 0xff89929e);
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

  void accent(Button b) {
    b.setTextColor(
        new android.content.res.ColorStateList(
            new int[][] {new int[] {android.R.attr.state_focused}, new int[] {}},
            new int[] {FG, BG}));
    b.setBackground(focusBackground(ACC));
  }

  void renderFilters() {
    if (filters == null) return;
    filters.removeAllViews();
    if (!mode.equals("Canales")) return;
    List<String> names = new ArrayList<>();
    names.add("Todos");
    names.addAll(Catalog.groups(channels).keySet());
    for (final String g : names) {
      Button b =
          button(
              g,
              new View.OnClickListener() {
                public void onClick(View v) {
                  group = g;
                  renderFilters();
                  render();
                }
              });
      b.setId(1000 + Math.abs(g.hashCode() % 90000));
      if (g.equals(group)) b.setTextColor(ACC);
      addButton(filters, b);
    }
  }

  void heading(String title, String sub) {
    LinearLayout r = row();
    TextView t = text(title, wide() ? 22 : 20);
    t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    r.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
    if (sub != null) r.addView(label(sub, 12, 0xff89929e));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(0, dp(17), 0, dp(5));
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
      if (!featured.isEmpty()) hero(featured.get(0));
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

  void hero(final Catalog.Channel c) {
    FrameLayout frame = new FrameLayout(this);
    frame.setBackground(
        new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT, new int[] {0xff11151b, 0xff1d2a12}));
    ImageView logo = new ImageView(this);
    logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
    FrameLayout.LayoutParams lp =
        new FrameLayout.LayoutParams(dp(wide() ? 200 : 120), dp(wide() ? 200 : 120));
    lp.gravity = Gravity.END | Gravity.CENTER_VERTICAL;
    lp.setMargins(0, 0, dp(24), 0);
    frame.addView(logo, lp);
    image(logo, c.logo);
    logo.setBackgroundColor(Color.TRANSPARENT);
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.BOTTOM);
    content.setPadding(dp(18), dp(18), dp(18), dp(18));
    content.addView(label("● EN DIRECTO  /  " + c.group, 12, ACC));
    TextView title = text(c.name, wide() ? 34 : 27);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setMaxLines(2);
    content.addView(title);
    content.addView(
        label(c.own ? "Canal de Calamar TV" : "Emisión oficial en abierto", 13, 0xffd1d6de));
    Button watch =
        button(
            "▶  Ver ahora",
            new View.OnClickListener() {
              public void onClick(View v) {
                open(c);
              }
            });
    accent(watch);
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, dp(46));
    bp.setMargins(dp(12), dp(14), 0, 0);
    content.addView(watch, bp);
    frame.addView(content, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(wide() ? 280 : 250));
    p.setMargins(0, dp(12), 0, dp(4));
    list.addView(frame, p);
  }

  View card(final Catalog.Channel c, int width) {
    LinearLayout card = new LinearLayout(this);
    card.setId(100000 + Math.abs(c.id.hashCode() % 800000));
    card.setOrientation(LinearLayout.VERTICAL);
    card.setPadding(dp(2), dp(2), dp(2), dp(10));
    focusable(card);
    FrameLayout art = new FrameLayout(this);
    art.setBackground(rounded(0xff202731, 0));
    ImageView logo = new ImageView(this);
    logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(-1, -1);
    lp.setMargins(dp(22), dp(16), dp(22), dp(16));
    art.addView(logo, lp);
    image(logo, c.logo);
    logo.setBackgroundColor(Color.TRANSPARENT);
    TextView badge = label(c.playable() ? "EN DIRECTO" : "SU WEB", 10, c.playable() ? BG : FG);
    badge.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    badge.setBackground(rounded(c.playable() ? ACC : 0xdd171a20, 0));
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
    bp.setMargins(dp(8), dp(8), 0, 0);
    art.addView(badge, bp);
    card.addView(art, new LinearLayout.LayoutParams(-1, dp(110)));
    TextView name = text(c.name, 15);
    name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    name.setSingleLine(true);
    card.addView(name);
    TextView sub = label(c.region.isEmpty() ? c.group : c.region, 12, MUTED);
    sub.setSingleLine(true);
    card.addView(sub);
    card.setOnClickListener(
        new View.OnClickListener() {
          public void onClick(View v) {
            open(c);
          }
        });
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -2);
    p.setMargins(dp(5), dp(4), dp(8), dp(8));
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
      r.addView(card(a.get(i), wide() ? 200 : 170));
    h.addView(r);
    list.addView(h);
  }

  void grid() {
    int columns = wide() ? 4 : 2;
    int width =
        (getResources().getConfiguration().screenWidthDp - (wide() ? 56 : 24)) / columns - 15;
    for (Map.Entry<String, List<Catalog.Channel>> e : Catalog.groups(channels).entrySet()) {
      if (!group.equals("Todos") && !group.equals(e.getKey())) continue;
      heading(e.getKey(), e.getValue().size() + " canales");
      String region = null;
      LinearLayout r = null;
      int i = 0;
      for (Catalog.Channel c : regionSorted(e.getValue())) {
        if (!c.region.isEmpty() && !c.region.equals(region)) {
          region = c.region;
          list.addView(label(region.toUpperCase(new Locale("es", "ES")), 12, ACC));
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

  GradientDrawable rounded(int color, int border) {
    GradientDrawable g = new GradientDrawable();
    g.setColor(color);
    g.setCornerRadius(dp(9));
    if (border != 0) g.setStroke(dp(2), border);
    return g;
  }

  StateListDrawable focusBackground(int normal) {
    StateListDrawable s = new StateListDrawable();
    s.addState(new int[] {android.R.attr.state_focused}, rounded(0xff30352a, ACC));
    s.addState(new int[] {android.R.attr.state_pressed}, rounded(0xff30352a, ACC));
    s.addState(new int[] {}, rounded(normal, 0));
    return s;
  }

  void focusable(View v) {
    v.setFocusable(true);
    v.setClickable(true);
    v.setBackground(focusBackground(0xff191d23));
    v.setOnFocusChangeListener(
        new View.OnFocusChangeListener() {
          public void onFocusChange(View w, boolean f) {
            w.animate().scaleX(f ? 1.015f : 1f).scaleY(f ? 1.015f : 1f).setDuration(120).start();
          }
        });
  }

  Button button(String t, View.OnClickListener l) {
    Button b = new Button(this);
    b.setText(t);
    b.setTextSize(14);
    b.setTextColor(FG);
    b.setAllCaps(false);
    b.setBackground(focusBackground(0xff1b2027));
    b.setPadding(dp(17), dp(6), dp(17), dp(6));
    b.setMinHeight(0);
    b.setMinimumHeight(0);
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
    view.setBackgroundColor(0xff202731);
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
    list.addView(
        label(
            "Añade enlaces de vídeo (.ts, .m3u8, .mpd, .mp4) o la página https de un reproductor:"
                + " la app obtiene su fuente actual y la renueva al caducar. Se guardan solo en"
                + " este dispositivo. Mantén pulsado un canal para editarlo o eliminarlo.",
            12,
            0xffa4acb7));
    LinearLayout actions = row();
    Button add =
        button(
            "+  Añadir canal",
            new View.OnClickListener() {
              public void onClick(View v) {
                editChannel(-1);
              }
            });
    add.setBackground(focusBackground(ACC));
    add.setTextColor(
        new android.content.res.ColorStateList(
            new int[][] {new int[] {android.R.attr.state_focused}, new int[] {}},
            new int[] {FG, BG}));
    addButton(actions, add);
    list.addView(actions);
    int cols = wide() ? 3 : 2,
        width = (getResources().getConfiguration().screenWidthDp - (wide() ? 56 : 24)) / cols - 14;
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
      c.setGravity(Gravity.CENTER);
      c.setPadding(dp(10), dp(18), dp(10), dp(18));
      focusable(c);
      c.addView(label("▶", 28, ACC));
      TextView name = text(channel.optString("name"), 16);
      name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      name.setGravity(Gravity.CENTER);
      name.setMinLines(2);
      c.addView(name);
      TextView host = label(Uri.parse(channel.optString("url")).getHost(), 10, 0xffa4acb7);
      host.setSingleLine(true);
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
      p.setMargins(dp(5), dp(5), dp(5), dp(5));
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
