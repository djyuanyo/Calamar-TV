package es.yuanyo.calamartv;

import android.app.*;
import android.content.res.Configuration;
import android.graphics.*;
import android.graphics.drawable.*;
import android.os.*;
import android.util.LruCache;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.text.*;
import java.util.*;
import org.json.*;

public class MainActivity extends Activity {
  final int BG = 0xff0b0d10, FG = 0xfff5f5f5, ACC = 0xffd6ff00;
  LinearLayout root, list, filters;
  TextView message;
  JSONArray events = new JSONArray();
  JSONArray channelCatalog = new JSONArray();
  String dataOrigin = "Sin datos", loadError = "";
  String sport = "Todos", mode = "Inicio";
  boolean busy = false;
  long lastUpdate = 0;
  final LruCache<String, Bitmap> images =
      new LruCache<String, Bitmap>(12 * 1024 * 1024) {
        protected int sizeOf(String k, Bitmap b) {
          return b.getByteCount();
        }
      };
  WebView web;
  View custom;
  WebChromeClient.CustomViewCallback customCallback;
  Handler handler = new Handler();
  Runnable refresh =
      new Runnable() {
        public void run() {
          load();
          handler.postDelayed(this, 60000);
        }
      };

  int dp(int n) {
    return (int) (getResources().getDisplayMetrics().density * n + .5f);
  }

  public void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(128);
    restoreContent();
    home();
    load();
    handler.postDelayed(refresh, 60000);
  }

  boolean wide() {
    return getResources().getConfiguration().screenWidthDp >= 700;
  }

  boolean television() {
    return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_TYPE_MASK)
        == Configuration.UI_MODE_TYPE_TELEVISION;
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
    TextView tag = label("SPORTS LIVE", 11, ACC);
    tag.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    mast.addView(tag);
    root.addView(mast);
    LinearLayout nav = row();
    for (final String m : new String[] {"Inicio", "En directo", "Agenda", "Canales"}) {
      Button tab =
          button(
              m,
              new View.OnClickListener() {
                public void onClick(View v) {
                  mode = m;
                  home();
                }
              });
      if (mode.equals(m)) {
        tab.setTextColor(
            new android.content.res.ColorStateList(
                new int[][] {new int[] {android.R.attr.state_focused}, new int[] {}},
                new int[] {FG, BG}));
        tab.setBackground(focusBackground(ACC));
      }
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

  String sportName(String s) {
    if (s.equals("Soccer")) return "Fútbol";
    if (s.equals("Basketball")) return "Baloncesto";
    if (s.equals("Tennis")) return "Tenis";
    if (s.equals("Motorsport")) return "Motor";
    if (s.equals("Hockey")) return "Hockey";
    if (s.equals("Football")) return "Fútbol americano";
    if (s.equals("Other")) return "Otros";
    return s;
  }

  void renderFilters() {
    filters.removeAllViews();
    TreeSet<String> sports = new TreeSet<String>();
    for (int i = 0; i < events.length(); i++) {
      JSONObject e = events.optJSONObject(i);
      if (e != null && !e.optString("sport_category").isEmpty())
        sports.add(e.optString("sport_category"));
    }
    ArrayList<String> all = new ArrayList<String>();
    all.add("Todos");
    all.addAll(sports);
    for (final String s : all) {
      Button b =
          button(
              sportName(s),
              new View.OnClickListener() {
                public void onClick(View v) {
                  sport = s;
                  renderFilters();
                  render();
                }
              });
      b.setId(1000 + Math.abs(s.hashCode() % 90000));
      if (s.equals(sport)) b.setTextColor(ACC);
      addButton(filters, b);
    }
  }

  boolean freshContent() {
    return dataOrigin.equals("En línea") && System.currentTimeMillis() - lastUpdate < 180000;
  }

  InputStream openInitialContent() throws IOException {
    // Android packaging may transparently unpack .gz assets and remove that suffix.
    try { return getAssets().open("events-initial.json"); }
    catch (IOException plainMissing) {
      return new java.util.zip.GZIPInputStream(getAssets().open("events-initial.json.gz"));
    }
  }

  void restoreContent() {
    try {
      JSONObject initial =
          EventData.decode(
              EventData.read(
                  openInitialContent()));
      events = initial.getJSONArray("data");
      lastUpdate = initial.optLong("updated_at");
      channelCatalog = EventData.mergeChannels(new JSONArray(), events, lastUpdate);
      dataOrigin = "Contenido inicial";
    } catch (Exception ignored) {
    }
    File file = new File(getFilesDir(), "events-cache.json");
    if (file.isFile())
      try {
        JSONObject saved = EventData.decode(EventData.read(new FileInputStream(file)));
        if (saved.optLong("updated_at") >= lastUpdate) {
          events = saved.getJSONArray("data");
          lastUpdate = saved.optLong("updated_at");
          channelCatalog = saved.optJSONArray("channels");
          if (channelCatalog == null)
            channelCatalog = EventData.mergeChannels(new JSONArray(), events, lastUpdate);
          dataOrigin = "Datos guardados";
        }
      } catch (Exception ignored) {
      }
  }

  void load() {
    if (busy) return;
    busy = true;
    loadError = "";
    if (web == null && message != null) message.setText(dataOrigin + " · Actualizando eventos…");
    new AsyncTask<Void, Void, JSONObject>() {
      String error;

      protected JSONObject doInBackground(Void... v) {
        try {
          HttpURLConnection c =
              (HttpURLConnection) new URL("https://bp.zicotv.cc/api/v1/events").openConnection();
          c.setConnectTimeout(10000);
          c.setReadTimeout(15000);
          c.setRequestProperty("Accept", "application/json");
          c.setRequestProperty("User-Agent", "CalamarTV/1.2.0 (Android; API client)");
          try {
            int status = c.getResponseCode();
            if (status != 200) throw new IOException("HTTP " + status);
            JSONObject result = EventData.decode(EventData.read(c.getInputStream()));
            long now = System.currentTimeMillis();
            JSONArray channels =
                EventData.mergeChannels(channelCatalog, result.getJSONArray("data"), now);
            result.put("channels", channels).put("updated_at", now);
            try {
              EventData.save(new File(getFilesDir(), "events-cache.json"), result);
            } catch (IOException cacheError) {
              android.util.Log.w("CalamarTV", "No se pudo guardar caché", cacheError);
            }
            return result;
          } finally {
            c.disconnect();
          }
        } catch (Exception e) {
          if (e instanceof java.net.UnknownHostException)
            error = "No se encuentra el servidor de ZicoTV";
          else if (e instanceof java.net.SocketTimeoutException)
            error = "ZicoTV tarda en responder";
          else if (e instanceof javax.net.ssl.SSLException)
            error = "Error de conexión segura con ZicoTV";
          else if (e.getMessage() != null && e.getMessage().startsWith("HTTP "))
            error = "ZicoTV responde " + e.getMessage();
          else error = "No se pudo descargar la agenda";
          return null;
        }
      }

      protected void onPostExecute(JSONObject result) {
        busy = false;
        if (isFinishing()) return;
        if (result != null) {
          events = result.optJSONArray("data");
          channelCatalog = result.optJSONArray("channels");
          lastUpdate = result.optLong("updated_at");
          dataOrigin = "En línea";
        }
        loadError =
            error == null ? "" : error + " · Pulsa Actualizar. Se mantienen los datos disponibles.";
        if (web == null) {
          View focused = getCurrentFocus();
          int focusId = focused != null ? focused.getId() : View.NO_ID;
          renderFilters();
          render();
          if (focusId != View.NO_ID) {
            View replacement = root.findViewById(focusId);
            if (replacement != null) replacement.requestFocus();
          }
        }
      }
    }.execute();
  }

  long time(JSONObject e) {
    try {
      String timestamp =
          e.optString("start_time")
              .replaceAll("Z$", "+0000")
              .replaceAll("([+-]\\d{2}):(\\d{2})$", "$1$2");
      return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US).parse(timestamp).getTime();
    } catch (Exception x) {
      return Long.MAX_VALUE;
    }
  }

  String date(JSONObject e) {
    long t = time(e);
    if (t == Long.MAX_VALUE) return "Horario por confirmar";
    SimpleDateFormat f = new SimpleDateFormat("EEE d MMM · HH:mm", new Locale("es", "ES"));
    f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
    return f.format(new Date(t));
  }

  void heading(String title, String sub) {
    LinearLayout r = row();
    TextView t = text(title, wide() ? 23 : 21);
    t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    r.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
    if (sub != null) r.addView(label(sub, 12, 0xff89929e));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(0, dp(17), 0, dp(5));
    list.addView(r, p);
  }

  ArrayList<JSONObject> filtered() {
    ArrayList<JSONObject> a = new ArrayList<JSONObject>();
    for (int i = 0; i < events.length(); i++) {
      JSONObject e = events.optJSONObject(i);
      if (e == null || (!sport.equals("Todos") && !sport.equals(e.optString("sport_category"))))
        continue;
      a.add(e);
    }
    Collections.sort(
        a,
        new Comparator<JSONObject>() {
          public int compare(JSONObject a, JSONObject b) {
            return Long.compare(time(a), time(b));
          }
        });
    return a;
  }

  String state(JSONObject e) {
    String s = e.optString("status");
    if (s.equals("live") && !freshContent()) return "ESTADO POR ACTUALIZAR";
    return s.equals("live")
        ? "EN DIRECTO"
        : s.equals("finished")
            ? "FINALIZADO"
            : s.equals("cancelled") ? "CANCELADO" : "PRÓXIMAMENTE";
  }

  void render() {
    if (list == null || web != null) return;
    list.removeAllViews();
    ArrayList<JSONObject> all = filtered(),
        now = new ArrayList<JSONObject>(),
        next = new ArrayList<JSONObject>(),
        past = new ArrayList<JSONObject>();
    for (JSONObject e : all) {
      String s = e.optString("status");
      if (s.equals("live")) now.add(e);
      else if (s.equals("scheduled")) next.add(e);
      else past.add(e);
    }
    SimpleDateFormat stamp = new SimpleDateFormat("dd/MM HH:mm", Locale.getDefault());
    stamp.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
    message.setText(
        dataOrigin
            + (busy ? " · Actualizando" : "")
            + "  /  "
            + all.size()
            + " eventos  /  "
            + channelCatalog.length()
            + " canales"
            + (lastUpdate > 0 ? "  /  " + stamp.format(new Date(lastUpdate)) : "")
            + " · Hora peninsular"
            + (loadError.isEmpty() ? "" : "\n" + loadError));
    if (mode.equals("Canales")) {
      channels(all);
      return;
    }
    if (all.isEmpty()) {
      heading(busy ? "Buscando el próximo gran partido" : "Sin eventos disponibles", null);
      list.addView(
          label(
              "Cambia de deporte o pulsa Actualizar para volver a consultar la agenda.",
              15,
              0xffa4acb7));
      return;
    }
    if (mode.equals("Canales")) {
      channels(all);
      return;
    }
    if (mode.equals("Agenda")) {
      heading("Tu agenda deportiva", all.size() + " eventos");
      agenda(all);
      return;
    }
    if (mode.equals("En directo")) {
      heading(
          freshContent() ? "El deporte está pasando ahora" : "Directos · estado por actualizar",
          now.size() + " eventos");
      if (now.isEmpty())
        list.addView(label("No hay eventos en directo para este deporte.", 16, 0xffa4acb7));
      else grid(now);
      return;
    }
    if (!now.isEmpty()) hero(now.get(0));
    else if (!next.isEmpty()) hero(next.get(0));
    if (!now.isEmpty()) {
      heading(freshContent() ? "En directo" : "Directos · por actualizar", now.size() + " eventos");
      carousel(now);
    }
    if (!next.isEmpty()) {
      heading("Lo próximo", next.size() + " eventos");
      carousel(next);
    }
    if (!past.isEmpty()) {
      heading("Ya disputados", past.size() + " eventos");
      Collections.reverse(past);
      carousel(past);
    }
    TextView note = label("Canales y reproducción proporcionados por ZicoTV", 11, 0xff727b88);
    list.addView(note);
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

  View art(JSONObject e, int height) {
    FrameLayout f = new FrameLayout(this);
    ImageView photo = new ImageView(this);
    photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
    f.addView(photo, new FrameLayout.LayoutParams(-1, -1));
    image(photo, e.optString("thumbnail_url"));
    LinearLayout teams = row();
    teams.setGravity(Gravity.CENTER);
    for (String key : new String[] {"home_team_badge", "away_team_badge"}) {
      ImageView badge = new ImageView(this);
      badge.setScaleType(ImageView.ScaleType.FIT_CENTER);
      LinearLayout.LayoutParams p =
          new LinearLayout.LayoutParams(dp(height > 200 ? 72 : 48), dp(height > 200 ? 72 : 48));
      p.setMargins(dp(15), dp(10), dp(15), dp(10));
      teams.addView(badge, p);
      image(badge, e.optString(key));
      badge.setBackgroundColor(Color.TRANSPARENT);
    }
    f.addView(teams, new FrameLayout.LayoutParams(-1, -1));
    TextView status = label(state(e), 11, e.optString("status").equals("live") ? BG : FG);
    status.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    status.setBackground(rounded(e.optString("status").equals("live") ? ACC : 0xdd171a20, 0));
    FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.LEFT);
    sp.setMargins(dp(12), dp(12), 0, 0);
    f.addView(status, sp);
    f.setLayoutParams(new LinearLayout.LayoutParams(-1, dp(height)));
    return f;
  }

  void hero(final JSONObject e) {
    FrameLayout frame = new FrameLayout(this);
    ImageView photo = new ImageView(this);
    photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
    frame.addView(photo, new FrameLayout.LayoutParams(-1, -1));
    image(photo, e.optString("thumbnail_url"));
    View shade = new View(this);
    shade.setBackground(
        new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            new int[] {0xf50b0d10, 0xb00b0d10, 0x250b0d10}));
    frame.addView(shade, new FrameLayout.LayoutParams(-1, -1));
    LinearLayout content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    content.setGravity(Gravity.BOTTOM);
    content.setPadding(dp(18), dp(18), dp(18), dp(18));
    content.addView(label(state(e) + "  /  " + sportName(e.optString("sport_category")), 12, ACC));
    TextView title = text(e.optString("title"), wide() ? 32 : 25);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setMaxLines(3);
    content.addView(title);
    content.addView(label(e.optString("league") + "  ·  " + date(e), 13, 0xffd1d6de));
    Button watch =
        button(
            freshContent() && e.optString("status").equals("live")
                ? "▶  Ver ahora"
                : "▶  Ver fuentes",
            new View.OnClickListener() {
              public void onClick(View v) {
                choose(e);
              }
            });
    watch.setBackground(focusBackground(ACC));
    watch.setTextColor(
        new android.content.res.ColorStateList(
            new int[][] {new int[] {android.R.attr.state_focused}, new int[] {}},
            new int[] {FG, BG}));
    LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(-2, dp(46));
    bp.setMargins(dp(12), dp(14), 0, 0);
    content.addView(watch, bp);
    frame.addView(content, new FrameLayout.LayoutParams(wide() ? dp(560) : -1, -1));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(wide() ? 300 : 285));
    p.setMargins(0, dp(12), 0, dp(4));
    list.addView(frame, p);
  }

  View eventCard(final JSONObject e, int width) {
    LinearLayout c = new LinearLayout(this);
    c.setId(100000 + e.optInt("id"));
    c.setOrientation(LinearLayout.VERTICAL);
    c.setPadding(dp(2), dp(2), dp(2), dp(10));
    focusable(c);
    c.addView(art(e, 135));
    TextView title = text(e.optString("title"), 16);
    title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    title.setMaxLines(2);
    title.setMinLines(2);
    c.addView(title);
    TextView league = label(e.optString("league"), 12, 0xffa4acb7);
    league.setSingleLine(true);
    c.addView(league);
    c.addView(label(date(e), 12, ACC));
    c.setOnClickListener(
        new View.OnClickListener() {
          public void onClick(View v) {
            choose(e);
          }
        });
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -2);
    p.setMargins(dp(5), dp(4), dp(8), dp(8));
    c.setLayoutParams(p);
    return c;
  }

  void carousel(ArrayList<JSONObject> a) {
    HorizontalScrollView h = new HorizontalScrollView(this);
    h.setHorizontalScrollBarEnabled(false);
    h.setClipToPadding(false);
    LinearLayout r = row();
    r.setGravity(Gravity.TOP);
    for (int i = 0; i < Math.min(a.size(), 30); i++)
      r.addView(eventCard(a.get(i), wide() ? 260 : 245));
    h.addView(r);
    list.addView(h);
    if (a.size() > 30) list.addView(label("Consulta todos los eventos en Agenda", 12, 0xffa4acb7));
  }

  void grid(ArrayList<JSONObject> a) {
    int columns = wide() ? 3 : 1;
    int width =
        (getResources().getConfiguration().screenWidthDp - (wide() ? 56 : 24)) / columns - 15;
    LinearLayout r = null;
    for (int i = 0; i < a.size(); i++) {
      if (i % columns == 0) {
        r = row();
        r.setGravity(Gravity.TOP);
        list.addView(r);
      }
      r.addView(eventCard(a.get(i), width));
    }
  }

  void agenda(ArrayList<JSONObject> all) {
    String previous = "";
    for (final JSONObject e : all) {
      String date = date(e), day = date.contains(" · ") ? date.split(" · ")[0] : date;
      if (!day.equals(previous)) {
        heading(day.toUpperCase(new Locale("es", "ES")), null);
        previous = day;
      }
      LinearLayout c = new LinearLayout(this);
      c.setId(100000 + e.optInt("id"));
      c.setOrientation(LinearLayout.VERTICAL);
      c.setPadding(dp(10), dp(9), dp(10), dp(9));
      focusable(c);
      c.addView(
          label(
              date + "   /   " + state(e),
              12,
              e.optString("status").equals("live") ? ACC : 0xffa4acb7));
      TextView t = text(e.optString("title"), 18);
      t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      c.addView(t);
      c.addView(
          label(
              sportName(e.optString("sport_category")) + " · " + e.optString("league"),
              12,
              0xffa4acb7));
      c.setOnClickListener(
          new View.OnClickListener() {
            public void onClick(View v) {
              choose(e);
            }
          });
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
      p.setMargins(dp(5), dp(4), dp(5), dp(5));
      list.addView(c, p);
    }
  }

  void channels(ArrayList<JSONObject> all) {
    TreeMap<String, JSONObject[]> channels = new TreeMap<String, JSONObject[]>();
    for (int k = 0; k < channelCatalog.length(); k++) {
      JSONObject item = channelCatalog.optJSONObject(k);
      if (item == null) continue;
      JSONObject source = item.optJSONObject("source"), event = item.optJSONObject("event");
      if (source == null || event == null) continue;
      if (!sport.equals("Todos") && !sport.equals(event.optString("sport_category"))) continue;
      channels.put(
          source.optString("name", "Canal") + source.optString("url"),
          new JSONObject[] {source, event});
    }
    HashSet<String> seen = new HashSet<String>();
    for (JSONObject e : all) {
      JSONArray src = e.optJSONArray("sources");
      if (src == null) continue;
      for (int i = 0; i < src.length(); i++) {
        JSONObject s = src.optJSONObject(i);
        if (s == null || !s.optString("source").equals("own")) continue;
        String u = s.optString("player_url", s.optString("url"));
        if (u.startsWith("https://")
            && seen.add(u)
            && !channels.containsKey(s.optString("name", "Canal") + u))
          channels.put(s.optString("name", "Canal") + u, new JSONObject[] {s, e});
      }
    }
    heading("Tus canales deportivos", channels.size() + " canales");
    list.addView(label("Catálogo guardado de canales detectados en la API", 12, 0xffa4acb7));
    int cols = wide() ? 3 : 2,
        width = (getResources().getConfiguration().screenWidthDp - (wide() ? 56 : 24)) / cols - 14,
        i = 0;
    LinearLayout r = null;
    for (final JSONObject[] entry : channels.values()) {
      if (i++ % cols == 0) {
        r = row();
        r.setGravity(Gravity.TOP);
        list.addView(r);
      }
      LinearLayout c = new LinearLayout(this);
      c.setId(200000 + Math.abs(entry[0].optString("url").hashCode() % 1000000));
      c.setOrientation(LinearLayout.VERTICAL);
      c.setGravity(Gravity.CENTER);
      c.setPadding(dp(10), dp(18), dp(10), dp(18));
      focusable(c);
      TextView icon = label("▶", 28, ACC);
      c.addView(icon);
      TextView name = text(entry[0].optString("name", "Canal"), 16);
      name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      name.setGravity(Gravity.CENTER);
      name.setMinLines(2);
      c.addView(name);
      c.addView(
          label(
              freshContent()
                      && System.currentTimeMillis() - entry[0].optLong("catalog_seen_at") < 180000
                      && entry[0].optBoolean("is_streaming")
                  ? "● EMITIENDO"
                  : "ESTADO SIN CONFIRMAR",
              10,
              entry[0].optBoolean("is_streaming") ? ACC : 0xffa4acb7));
      c.setOnClickListener(
          new View.OnClickListener() {
            public void onClick(View v) {
              play(entry[0], entry[1]);
            }
          });
      LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(width), -2);
      p.setMargins(dp(5), dp(5), dp(5), dp(5));
      r.addView(c, p);
    }
  }

  void choose(final JSONObject e) {
    final JSONArray s = e.optJSONArray("sources");
    if (s == null || s.length() == 0) {
      new AlertDialog.Builder(this)
          .setMessage("Este evento aún no tiene fuentes disponibles.")
          .setPositiveButton("Vale", null)
          .show();
      return;
    }
    String[] names = new String[s.length()];
    for (int i = 0; i < s.length(); i++) {
      JSONObject a = s.optJSONObject(i);
      names[i] = a.optString("name", a.optString("source", "Fuente"));
    }
    new AlertDialog.Builder(this)
        .setTitle(e.optString("title"))
        .setItems(
            names,
            new android.content.DialogInterface.OnClickListener() {
              public void onClick(android.content.DialogInterface d, int n) {
                play(s.optJSONObject(n), e);
              }
            })
        .setNegativeButton("Volver", null)
        .show();
  }

  void play(final JSONObject s, final JSONObject e) {
    if (web != null) {
      hideCustom();
      web.destroy();
      web = null;
    }
    String url = s.optString("player_url", s.optString("url"));
    if (!url.startsWith("https://")) {
      Toast.makeText(this, "Fuente no compatible", Toast.LENGTH_LONG).show();
      return;
    }
    root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(BG);
    root.setFitsSystemWindows(true);
    setContentView(root);
    LinearLayout bar = row();
    addButton(
        bar,
        button(
            "Volver",
            new View.OnClickListener() {
              public void onClick(View v) {
                closePlayer();
              }
            }));
    addButton(
        bar,
        button(
            "Reconectar",
            new View.OnClickListener() {
              public void onClick(View v) {
                web.reload();
              }
            }));
    addButton(
        bar,
        button(
            "Fuentes",
            new View.OnClickListener() {
              public void onClick(View v) {
                choose(e);
              }
            }));
    root.addView(bar);
    root.addView(text(s.optString("name", e.optString("title")), 18));
    web = new WebView(this);
    root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    try {
      WebSettings.class
          .getMethod("setMediaPlaybackRequiresUserGesture", boolean.class)
          .invoke(settings, false);
    } catch (Exception ignored) {
    }
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setSupportMultipleWindows(false);
    web.setWebViewClient(
        new WebViewClient() {
          public boolean shouldOverrideUrlLoading(WebView w, String u) {
            return !u.startsWith("https://");
          }
        });
    web.setWebChromeClient(
        new WebChromeClient() {
          public void onShowCustomView(View v, CustomViewCallback cb) {
            custom = v;
            customCallback = cb;
            root.setVisibility(View.GONE);
            addContentView(v, new ViewGroup.LayoutParams(-1, -1));
          }

          public void onHideCustomView() {
            hideCustom();
          }
        });
    web.loadDataWithBaseURL(
        "https://calamar-tv.invalid/",
        "<html><meta name='viewport' content='width=device-width,initial-scale=1'><body"
            + " style='margin:0;background:black'><iframe src='"
            + android.text.TextUtils.htmlEncode(url)
            + "' allow='autoplay; fullscreen; picture-in-picture' allowfullscreen referrerpolicy='"
            + (s.optString("referrer_policy").equals("origin") ? "origin" : "no-referrer")
            + "' style='border:0;width:100%;height:100%'></iframe></body></html>",
        "text/html",
        "UTF-8",
        null);
    web.requestFocus();
  }

  void hideCustom() {
    if (custom != null) {
      ((ViewGroup) custom.getParent()).removeView(custom);
      custom = null;
      root.setVisibility(View.VISIBLE);
      if (customCallback != null) customCallback.onCustomViewHidden();
      customCallback = null;
    }
  }

  void closePlayer() {
    hideCustom();
    if (web != null) {
      web.loadUrl("about:blank");
      web.destroy();
      web = null;
    }
    home();
  }

  public void onBackPressed() {
    if (custom != null) hideCustom();
    else if (web != null) closePlayer();
    else super.onBackPressed();
  }

  protected void onPause() {
    super.onPause();
    handler.removeCallbacks(refresh);
    if (web != null) web.onPause();
  }

  protected void onResume() {
    super.onResume();
    handler.removeCallbacks(refresh);
    handler.postDelayed(refresh, 60000);
    if (web != null) web.onResume();
  }

  protected void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    if (web != null) web.destroy();
    images.evictAll();
    super.onDestroy();
  }
}
