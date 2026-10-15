package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Page -> current media source -> Media3. Signed media URLs are kept in memory only. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public final class NativePlayerActivity extends Activity {
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final List<VideoResolver.Source> sources = new ArrayList<>();
  private ExoPlayer player;
  private PlayerView playerView;
  private WebView browser;
  private FrameLayout stage;
  private TextView status;
  private NetworkTransport transport;
  private String lastReport = "Aún no se ha consultado la fuente.";
  private boolean diagnosing;
  private String pageUrl, documentUrl, currentUrl = "", title;
  private int generation, selection, automaticAttempts;
  private long attemptWindow;
  private boolean active, resolving, webMode;
  private final Runnable renewal = () -> refreshAutomatically("Renovando la fuente…");

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    pageUrl = getIntent().getStringExtra("page_url");
    title = getIntent().getStringExtra("title");
    if (pageUrl == null || !pageUrl.startsWith("https://")) {
      finish();
      return;
    }
    documentUrl = pageUrl;
    transport = NetworkTransport.get(this);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setBackgroundColor(0xff0b0d10);
    layout.setFitsSystemWindows(true);
    LinearLayout controls = new LinearLayout(this);
    button(controls, "Volver", () -> finish());
    button(
        controls,
        "Renovar",
        () -> {
          automaticAttempts = 0;
          resolveFresh();
        });
    button(controls, "Fuentes", this::chooseSource);
    button(controls, "Modo web", this::openWeb);
    button(controls, "Diagnóstico", this::diagnose);
    button(controls, "Chrome / navegador", this::openBrowser);
    HorizontalScrollView scroll = new HorizontalScrollView(this);
    scroll.addView(controls);
    layout.addView(scroll);
    TextView heading = new TextView(this);
    heading.setText(title == null ? "Calamar TV" : title);
    heading.setTextColor(Color.WHITE);
    heading.setTextSize(19);
    heading.setPadding(16, 8, 16, 8);
    layout.addView(heading);
    status = new TextView(this);
    status.setTextColor(0xffd6ff00);
    status.setPadding(16, 4, 16, 10);
    layout.addView(status);
    stage = new FrameLayout(this);
    playerView = new PlayerView(this);
    playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
    playerView.setKeepScreenOn(true);
    playerView.setControllerAutoShow(true);
    playerView.setControllerShowTimeoutMs(4000);
    stage.addView(playerView, new FrameLayout.LayoutParams(-1, -1));
    layout.addView(stage, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(layout);
  }

  private void button(LinearLayout row, String text, Runnable action) {
    Button b = new Button(this);
    b.setText(text);
    b.setTextColor(Color.WHITE);
    b.setAllCaps(false);
    b.setFocusable(true);
    b.setOnClickListener(v -> action.run());
    row.addView(b);
  }

  @Override
  protected void onStart() {
    super.onStart();
    active = true;
    if (pageUrl != null) resolveFresh();
  }

  private void resolveFresh() {
    if (!active || resolving) return;
    webMode = false;
    clearWeb();
    resolving = true;
    handler.removeCallbacks(renewal);
    final int request = ++generation;
    status.setText("Buscando una fuente de vídeo vigente…");
    if (VideoResolver.isMedia(pageUrl)) {
      resolving = false;
      sources.clear();
      sources.add(new VideoResolver.Source("Vídeo directo", pageUrl));
      playSource(sources.get(0));
      return;
    }
    worker.execute(
        () -> {
          try {
            PlayerDocument.Result document = PlayerDocument.fetch(pageUrl, transport);
            List<VideoResolver.Source> found = VideoResolver.parse(document.html, document.url);
            handler.post(
                () -> {
                  if (!active || request != generation) return;
                  resolving = false;
                  documentUrl = document.url;
                  lastReport =
                      reportHeader() + "\nPágina: HTTP 200\nFuentes compatibles: " + found.size();
                  sources.clear();
                  sources.addAll(found);
                  if (sources.isEmpty()) {
                    openWeb();
                    status.setText("Pulsa ▶ en la página para detectar un vídeo compatible.");
                  } else {
                    selection = Math.min(selection, sources.size() - 1);
                    playSource(sources.get(selection));
                  }
                });
          } catch (Exception failure) {
            handler.post(
                () -> {
                  if (!active || request != generation) return;
                  resolving = false;
                  String reason = ConnectionReport.describe(failure);
                  lastReport = reportHeader() + "\nConsulta de página: " + reason;
                  if (player != null && player.isPlaying()) {
                    status.setText(
                        "No se pudo renovar. La emisión actual continúa; puedes pulsar Renovar.");
                  } else {
                    status.setText(
                        "No se pudo consultar "
                            + Uri.parse(pageUrl).getHost()
                            + ": "
                            + reason
                            + ". Motor: "
                            + transport.name()
                            + ". Pulsa Diagnóstico.");
                  }
                });
          }
        });
  }

  private void playSource(VideoResolver.Source source) {
    if (!active) return;
    long expiry = VideoResolver.expiryMillis(source.url);
    if (expiry > 0 && expiry <= System.currentTimeMillis()) {
      status.setText("El proveedor devolvió una fuente caducada. Pulsa Renovar o Modo web.");
      return;
    }
    clearWeb();
    webMode = false;
    playerView.setVisibility(View.VISIBLE);
    if (player != null && currentUrl.equals(source.url) && player.isPlaying()) {
      scheduleRenewal(source.url);
      return;
    }
    releasePlayer();
    DataSource.Factory http = transport.mediaFactory(mediaReferer());
    player =
        new ExoPlayer.Builder(this)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(http))
            .build();
    player.setAudioAttributes(
        new androidx.media3.common.AudioAttributes.Builder()
            .setUsage(androidx.media3.common.C.USAGE_MEDIA)
            .setContentType(androidx.media3.common.C.AUDIO_CONTENT_TYPE_MOVIE)
            .build(),
        true);
    player.setHandleAudioBecomingNoisy(true);
    playerView.setPlayer(player);
    final ExoPlayer instance = player;
    player.addListener(
        new Player.Listener() {
          @Override
          public void onPlaybackStateChanged(int state) {
            if (instance != player || !active) return;
            if (state == Player.STATE_READY)
              status.setText("Reproductor nativo · " + source.label + " · " + transport.name());
            else if (state == Player.STATE_BUFFERING) status.setText("Cargando vídeo…");
          }

          @Override
          public void onPlayerError(PlaybackException error) {
            if (instance != player || !active) return;
            lastReport +=
                "\nVídeo: " + error.getErrorCodeName() + " · " + ConnectionReport.describe(error);
            status.setText("No se pudo reproducir (" + error.getErrorCodeName() + ").");
            refreshAutomatically("Reconectando con una fuente vigente…");
          }
        });
    MediaItem.Builder item = new MediaItem.Builder().setUri(source.url);
    String path = Uri.parse(source.url).getPath();
    if (path != null && path.endsWith(".m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
    if (path != null && path.endsWith(".mpd")) item.setMimeType(MimeTypes.APPLICATION_MPD);
    currentUrl = source.url;
    player.setMediaItem(item.build());
    player.prepare();
    player.play();
    playerView.requestFocus();
    scheduleRenewal(source.url);
  }

  private void scheduleRenewal(String address) {
    handler.removeCallbacks(renewal);
    if (VideoResolver.isMedia(pageUrl)) return; // There is no page to re-resolve for a raw URL.
    long delay = VideoResolver.renewalDelay(address, System.currentTimeMillis());
    if (delay >= 0) handler.postDelayed(renewal, Math.max(15000L, delay));
  }

  private String mediaReferer() {
    Uri page = Uri.parse(documentUrl);
    // Signed page credentials must not be sent to a different CDN in the Referer.
    return page.getScheme() + "://" + page.getEncodedAuthority() + "/";
  }

  private void refreshAutomatically(String message) {
    if (!active || resolving || webMode) return;
    long now = android.os.SystemClock.elapsedRealtime();
    if (now - attemptWindow > 120000) {
      automaticAttempts = 0;
      attemptWindow = now;
    }
    if (++automaticAttempts > 3 || VideoResolver.isMedia(pageUrl)) {
      status.setText("No se pudo recuperar la emisión. Pulsa Renovar, Fuentes o Modo web.");
      return;
    }
    status.setText(message);
    handler.postDelayed(renewalRequest, 1500);
  }

  private final Runnable renewalRequest = this::resolveFresh;

  private String reportHeader() {
    Uri page = Uri.parse(pageUrl);
    return "Calamar TV 1.3.1\nAndroid API "
        + android.os.Build.VERSION.SDK_INT
        + "\nPágina: "
        + page.getHost()
        + page.getPath()
        + "\nMotor: "
        + transport.name();
  }

  private void diagnose() {
    if (diagnosing) return;
    diagnosing = true;
    final int request = generation;
    final String previous = lastReport;
    status.setText("Comparando la conexión de los motores. Espera unos segundos…");
    worker.execute(
        () -> {
          String report = previous + "\n\nPrueba sin cambiar la red del dispositivo:\n";
          report += probe("Sistema", url -> (java.net.HttpURLConnection) url.openConnection());
          if (transport.hasChromium()) report += "\n" + probe("Chromium / HttpEngine", transport);
          final String result = report;
          handler.post(
              () -> {
                diagnosing = false;
                if (!active || generation != request) return;
                lastReport = result;
                status.setText("Diagnóstico disponible · Pulsa Copiar en la ventana.");
                new AlertDialog.Builder(this)
                    .setTitle("Diagnóstico de conexión")
                    .setMessage(result)
                    .setPositiveButton(
                        "Copiar",
                        (dialog, which) -> {
                          android.content.ClipboardManager clipboard =
                              (android.content.ClipboardManager)
                                  getSystemService(CLIPBOARD_SERVICE);
                          if (clipboard != null)
                            clipboard.setPrimaryClip(
                                android.content.ClipData.newPlainText(
                                    "Diagnóstico Calamar TV", result));
                          Toast.makeText(this, "Diagnóstico copiado", Toast.LENGTH_SHORT).show();
                        })
                    .setNegativeButton("Cerrar", null)
                    .show();
              });
        });
  }

  private String probe(String name, PlayerDocument.ConnectionFactory factory) {
    long start = android.os.SystemClock.elapsedRealtime();
    try {
      PlayerDocument.Result result = PlayerDocument.fetch(pageUrl, factory);
      int count = VideoResolver.parse(result.html, result.url).size();
      return name
          + ": HTTP 200 · "
          + count
          + " fuentes · "
          + (android.os.SystemClock.elapsedRealtime() - start)
          + " ms";
    } catch (Exception failure) {
      return name + ": " + ConnectionReport.describe(failure);
    }
  }

  private void chooseSource() {
    if (sources.isEmpty()) {
      Toast.makeText(this, "Aún no se ha detectado una fuente", Toast.LENGTH_SHORT).show();
      return;
    }
    String[] names = new String[sources.size()];
    for (int i = 0; i < names.length; i++) names[i] = sources.get(i).label;
    new AlertDialog.Builder(this)
        .setTitle("Fuentes de vídeo")
        .setSingleChoiceItems(
            names,
            selection,
            (dialog, index) -> {
              selection = index;
              automaticAttempts = 0;
              playSource(sources.get(index));
              dialog.dismiss();
            })
        .setNegativeButton("Cerrar", null)
        .show();
  }

  private void openWeb() {
    if (!active) return;
    ++generation;
    resolving = false;
    diagnosing = false;
    handler.removeCallbacks(renewal);
    handler.removeCallbacks(renewalRequest);
    releasePlayer();
    clearWeb();
    webMode = true;
    playerView.setVisibility(View.GONE);
    browser = new WebView(this);
    final int browserGeneration = generation;
    browser.getSettings().setJavaScriptEnabled(true);
    browser.getSettings().setDomStorageEnabled(true);
    browser.getSettings().setAllowFileAccess(false);
    browser.getSettings().setAllowContentAccess(false);
    android.webkit.CookieManager.getInstance().setAcceptCookie(true);
    browser.setWebViewClient(
        new WebViewClient() {
          @Override
          public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !url.startsWith("https://");
          }

          @Override
          public WebResourceResponse shouldInterceptRequest(
              WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if ("GET".equals(request.getMethod()) && VideoResolver.isMedia(url)) {
              handler.post(
                  () -> {
                    if (generation == browserGeneration) detected(url);
                  });
            }
            return null;
          }

          @Override
          public void onPageFinished(WebView view, String url) {
            if (!active || !webMode || generation != browserGeneration || browser != view) return;
            documentUrl = url;
            view.evaluateJavascript(
                "(function(){var v=document.querySelector('video');return"
                    + " v?(v.currentSrc||v.src||''):'';})()",
                value -> {
                  try {
                    String candidate = new org.json.JSONArray("[" + value + "]").optString(0);
                    if (generation == browserGeneration) detected(candidate);
                  } catch (Exception ignored) {
                  }
                });
          }
        });
    stage.addView(browser, new FrameLayout.LayoutParams(-1, -1));
    status.setText("Modo web · Pulsa ▶ para detectar el vídeo.");
    browser.loadUrl(pageUrl);
    browser.requestFocus();
  }

  private void detected(String address) {
    if (!active || !webMode || !VideoResolver.isMedia(address)) return;
    VideoResolver.Source source = new VideoResolver.Source("Vídeo detectado", address);
    sources.clear();
    sources.add(source);
    selection = 0;
    playSource(source);
  }

  private void openBrowser() {
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(pageUrl)));
    } catch (android.content.ActivityNotFoundException missing) {
      Toast.makeText(this, "No hay navegador instalado", Toast.LENGTH_LONG).show();
    }
  }

  private void clearWeb() {
    if (browser != null) {
      browser.stopLoading();
      stage.removeView(browser);
      browser.destroy();
      browser = null;
    }
  }

  private void releasePlayer() {
    if (player != null) {
      playerView.setPlayer(null);
      player.release();
      player = null;
    }
    currentUrl = "";
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    return playerView != null
            && playerView.getVisibility() == View.VISIBLE
            && playerView.dispatchKeyEvent(event)
        || super.dispatchKeyEvent(event);
  }

  @Override
  protected void onStop() {
    active = false;
    generation++;
    resolving = false;
    diagnosing = false;
    handler.removeCallbacksAndMessages(null);
    clearWeb();
    releasePlayer();
    super.onStop();
  }

  @Override
  protected void onDestroy() {
    worker.shutdownNow();
    super.onDestroy();
  }
}

