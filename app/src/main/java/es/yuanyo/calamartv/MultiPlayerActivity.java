package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.*;
import android.widget.*;
import androidx.media3.common.*;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.*;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.AspectRatioFrameLayout;
import java.util.*;
import java.util.concurrent.*;

/** Four independent native players. Adding a tile never restarts the other tiles. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class MultiPlayerActivity extends Activity {
  private SleepTimer sleepTimer;
  static final String TITLES = "titles", STREAMS = "streams";
  private final List<Tile> tiles = new ArrayList<>();
  private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
  private final ExecutorService worker = Executors.newFixedThreadPool(MultiScreen.MAX);
  private final Runnable hide = this::hideIfIdle;
  private LinearLayout rows, bar;
  private Button addButton;
  private Tile audible;
  private boolean controls, active;
  private Dialog picker;

  private final class Tile {
    final String title, target, channel;
    final List<String> urls;
    final FrameLayout frame;
    final PlayerView view;
    final TextView name, status, viewersBadge;
    final Button sound, remove;
    ExoPlayer player;
    HlsContinuity continuity;
    AudienceSession audience;
    MultiSource.Result resolved;
    String endpoint = Library.PLAYER_ENDPOINT, signal = "";
    int sourceIndex, attempt, generation;
    boolean loading;
    long initialPosition;
    final Runnable refresh = () -> resolve(true);
    final Runnable stalled = () -> fail(new java.net.SocketTimeoutException("La ventana no ha recibido vídeo"));

    Tile(String title, List<String> urls, String target, String channel) {
      this.title = title; this.urls = urls; this.target = target; this.channel = channel;
      frame = new FrameLayout(MultiPlayerActivity.this); frame.setBackgroundColor(Color.BLACK); frame.setFocusable(true); frame.setClickable(true);
      frame.setContentDescription(title); frame.setForeground(Ui.focusOutline(MultiPlayerActivity.this, 0));
      view = new PlayerView(MultiPlayerActivity.this); view.setUseController(false); view.setFocusable(false); view.setClickable(false);
      view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT); view.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING); frame.addView(view, new FrameLayout.LayoutParams(-1, -1));
      name = new TextView(MultiPlayerActivity.this); name.setTextSize(12); name.setTextColor(Color.WHITE); name.setSingleLine(true);
      name.setPadding(dp(8), dp(3), dp(8), dp(3)); name.setText(title); name.setBackground(Ui.shape(MultiPlayerActivity.this, 0x99000000, 6, 0, 0));
      FrameLayout.LayoutParams np = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START); np.setMargins(dp(8), dp(8), dp(48), 0); frame.addView(name, np);
      viewersBadge = Ui.audienceBadge(MultiPlayerActivity.this, 11); viewersBadge.setVisibility(View.GONE);
      FrameLayout.LayoutParams vp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.END); vp.setMargins(0, dp(8), dp(54), 0); frame.addView(viewersBadge, vp);
      status = new TextView(MultiPlayerActivity.this); status.setTextColor(Color.WHITE); status.setGravity(Gravity.CENTER); status.setTextSize(13); frame.addView(status, new FrameLayout.LayoutParams(-1, -2, Gravity.CENTER));
      sound = Ui.pill(MultiPlayerActivity.this, "🔇", Ui.Kind.SURFACE, true); sound.setContentDescription("Oír " + title);
      sound.setOnClickListener(v -> { listen(this); showControls(true); });
      FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(dp(52), dp(52), Gravity.BOTTOM | Gravity.END); sp.setMargins(0, 0, dp(10), dp(10)); frame.addView(sound, sp);
      remove = Ui.pill(MultiPlayerActivity.this, "✕", Ui.Kind.SURFACE, true); remove.setContentDescription("Quitar " + title);
      remove.setOnClickListener(v -> removeTile(this));
      FrameLayout.LayoutParams rp = new FrameLayout.LayoutParams(dp(40), dp(40), Gravity.TOP | Gravity.END); rp.setMargins(0, dp(8), dp(8), 0); frame.addView(remove, rp);
      frame.setOnClickListener(v -> showControls(!controls));
      frame.setOnFocusChangeListener((v, focused) -> { if (focused && !v.isInTouchMode()) { listen(this); showControls(true); } });
      if (AudienceModel.validTarget(target)) audience = createAudience(target, channel, title, count -> {
        viewersBadge.setVisibility(View.VISIBLE); viewersBadge.setText(count < 0 ? "—" : String.valueOf(count));
        viewersBadge.setContentDescription(count < 0 ? "Espectadores no disponibles" : count + " personas viendo");
      });
    }

    void start() { if (resolved != null && player == null) play(resolved); else resolve(false); }
    void resolve(boolean renewal) {
      if (!active || loading) return;
      if (sourceIndex >= urls.size()) { status.setText("No disponible. Quita esta pantalla o elige otro evento."); return; }
      loading = true; final int request = ++generation;
      final String page = renewal && resolved != null && resolved.page != null ? resolved.page : urls.get(sourceIndex);
      final String base = endpoint, selected = signal; final int round = attempt;
      final ExoPlayer decoder = player; final HlsContinuity session = continuity;
      final boolean background = renewal && decoder != null && session != null;
      if (!background && (player == null || !player.isPlaying())) status.setText("Conectando…");
      worker.execute(() -> {
        try {
          MultiSource.Result result = MultiSource.resolve(page, base, selected, round,
              NetworkTransport.get(DnsProvider.SYSTEM), NetworkTransport.get(MultiPlayerActivity.this));
          final boolean renewed = background && result.hosted() && session.update(result.url,
              PlayerDocument.fetch(result.url, NetworkTransport.get(DnsProvider.SYSTEM).pageFactory(true)).html);
          handler.post(() -> {
            if (!active || generation != request || !tiles.contains(this)) return;
            loading = false;
            if (background && player == decoder && continuity == session) {
              if (renewed) { resolved = result; scheduleRenewal(result); }
              else handler.postDelayed(refresh, 30000);
              return;
            }
            if (result.hosted()) try { endpoint = HostingPlayback.endpoint(result.url); } catch (java.io.IOException invalid) { fail(invalid); return; }
            if (player != null && player.isPlaying() && resolved != null && resolved.url.equals(result.url)) scheduleRenewal(result);
            else play(result);
          });
        } catch (Exception error) {
          handler.post(() -> {
            if (!active || generation != request || !tiles.contains(this)) return;
            loading = false;
            if (background && player == decoder || player != null && player.isPlaying()) { handler.postDelayed(refresh, 15000); return; }
            fail(error);
          });
        }
      });
    }
    void play(MultiSource.Result result) {
      long position = player != null && !player.isCurrentMediaItemLive() ? player.getCurrentPosition() : 0;
      stopPlayer(); resolved = result;
      boolean hosted = result.hosted();
      NetworkTransport network = hosted ? NetworkTransport.get(DnsProvider.SYSTEM) : NetworkTransport.get(MultiPlayerActivity.this);
      DataSource.Factory media = network.mediaFactory(result.referer, hosted, result.url, !hosted && result.page != null && !result.url.startsWith(Library.LULU_ENDPOINT));
      if (hosted) {
        final HlsContinuity session = continuity = new HlsContinuity(result.url);
        media = new ResolvingDataSource.Factory(media, data -> data.withUri(Uri.parse(session.resolve(data.uri.toString()))));
      }
      player = new ExoPlayer.Builder(MultiPlayerActivity.this).setRenderersFactory(new DefaultRenderersFactory(MultiPlayerActivity.this).setEnableDecoderFallback(true))
          .setLoadControl(new DefaultLoadControl.Builder().setBufferDurationsMs(3000, 15000, 750, 1500).build())
          .setMediaSourceFactory(new DefaultMediaSourceFactory(MultiPlayerActivity.this).setDataSourceFactory(
              media))
          .build();
      final ExoPlayer instance = player; view.setPlayer(instance);
      if (audience != null) audience.open();
      instance.addListener(new Player.Listener() {
        @Override public void onIsPlayingChanged(boolean playing) { if (instance == player && audience != null) audience.watching(playing); }
        @Override public void onPlaybackStateChanged(int state) {
          if (instance != player) return;
          handler.removeCallbacks(stalled);
          if (state == Player.STATE_READY) { status.setText(""); attempt = 0; scheduleRenewal(result); }
          else if (state == Player.STATE_BUFFERING) handler.postDelayed(stalled, hosted ? 60000 : 30000);
        }
        @Override public void onPlayerError(PlaybackException error) { if (instance == player) fail(error); }
      });
      MediaItem.Builder item = new MediaItem.Builder().setUri(result.url);
      String path = Uri.parse(result.url).getPath();
      if (hosted || result.url.startsWith(Library.LULU_ENDPOINT) || path != null && path.endsWith(".m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
      if (path != null && path.endsWith(".mpd")) item.setMimeType(MimeTypes.APPLICATION_MPD);
      if ("ts".equals(UserChannels.kind(result.url)) || CastSource.needsBridge(result.url)) item.setMimeType(MimeTypes.VIDEO_MP2T);
      instance.setMediaItem(item.build()); instance.setVolume(audible == this ? 1f : 0f);
      if (initialPosition > 0 || position > 0) { instance.seekTo(initialPosition > 0 ? initialPosition : position); initialPosition = 0; }
      instance.prepare(); instance.play();
    }
    void scheduleRenewal(MultiSource.Result result) {
      handler.removeCallbacks(refresh); long delay = result.renewalDelay(); if (delay >= 0) handler.postDelayed(refresh, delay);
    }
    void fail(Throwable error) {
      if (!active || !tiles.contains(this)) return;
      handler.removeCallbacks(stalled); handler.removeCallbacks(refresh);
      boolean renewable = resolved != null && resolved.renewable() || sourceIndex < urls.size() && UserChannels.isPage(urls.get(sourceIndex));
      if (resolved != null && resolved.hosted() && Library.PLAYER_ENDPOINT.equals(endpoint) && HostingPlayback.networkUnavailable(error)) endpoint = HostingPlayback.ALTERNATE_ENDPOINT;
      if (player != null && !player.isCurrentMediaItemLive()) initialPosition = player.getCurrentPosition();
      stopPlayer();
      if (renewable && ++attempt <= 3) { status.setText("Reconectando…"); handler.postDelayed(refresh, 1000); }
      else { sourceIndex++; attempt = 0; resolved = null; handler.postDelayed(refresh, 500); }
    }
    void stopPlayer() {
      continuity = null;
      handler.removeCallbacks(stalled); handler.removeCallbacks(refresh);
      if (player != null) { view.setPlayer(null); player.release(); player = null; }
    }
    void stop() {
      generation++; loading = false; stopPlayer(); if (audience != null) audience.close();
    }
  }

  AudienceSession createAudience(String target, String channel, String title, AudienceSession.Count count) { return new AudienceSession(this, target, channel, title, count); }

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    ArrayList<String> requestedTargets = getIntent().getStringArrayListExtra("audience_targets");
    if (getIntent().hasExtra("progress_entry") || requestedTargets != null && requestedTargets.stream().anyMatch(t -> t != null && t.startsWith("l:"))) { finish(); return; }
    ArrayList<String> titles = getIntent().getStringArrayListExtra(TITLES), streams = getIntent().getStringArrayListExtra(STREAMS);
    if (titles == null || streams == null || titles.isEmpty() || titles.size() != streams.size()) { finish(); return; }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    FrameLayout screen = new FrameLayout(this); rows = new LinearLayout(this); rows.setOrientation(LinearLayout.VERTICAL); rows.setBackgroundColor(Color.BLACK); screen.addView(rows, new FrameLayout.LayoutParams(-1, -1));
    bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setPadding(dp(8), dp(8), dp(8), dp(14));
    bar.setBackground(new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0xd9000000, 0x00000000}));
    Button exit = Ui.pill(this, "✕ Salir", Ui.Kind.SURFACE, true); exit.setOnClickListener(v -> finish()); bar.addView(exit);
    addButton = Ui.pill(this, "Añadir evento", Ui.Kind.SURFACE, true); addButton.setContentDescription("Añadir evento a multipantalla"); addButton.setOnClickListener(v -> chooseEvent()); bar.addView(addButton);
    if (SleepTimer.supported(this)) {
      sleepTimer = new SleepTimer(this, state == null ? getIntent().getLongExtra(SleepTimer.DEADLINE, 0) : state.getLong(SleepTimer.DEADLINE),
          () -> {
            active = false;
            for (Tile tile : tiles) tile.stop();
            setResult(SleepTimer.MULTI_SLEEP);
            super.finish();
          });
      bar.addView(sleepTimer.button(), new LinearLayout.LayoutParams(dp(44), dp(44)));
    }
    screen.addView(bar, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP)); setContentView(screen);
    ArrayList<String> targets = getIntent().getStringArrayListExtra("audience_targets"), channels = getIntent().getStringArrayListExtra("audience_channels");
    for (int i = 0; i < Math.min(titles.size(), MultiScreen.MAX); i++) append(titles.get(i), Arrays.asList(streams.get(i).split("\n")), targets != null && i < targets.size() ? targets.get(i) : "", channels != null && i < channels.size() ? channels.get(i) : "");
    Tile first = tiles.get(0); first.initialPosition = getIntent().getLongExtra("initial_position", 0);
    String initialPage = getIntent().getStringExtra("initial_page");
    if (initialPage != null && first.urls.remove(initialPage)) first.urls.add(0, initialPage);
    first.endpoint = getIntent().getStringExtra("initial_endpoint"); if (first.endpoint == null || !HostingPlayback.isRelay(first.endpoint)) first.endpoint = Library.PLAYER_ENDPOINT;
    first.signal = getIntent().getStringExtra("initial_signal"); if (first.signal == null) first.signal = "";
    String initial = getIntent().getStringExtra("initial_media");
    if (initial != null && !initial.isEmpty() && !first.urls.isEmpty() && (VideoResolver.isMedia(initial) || HostingPlayback.isRelay(initial) || initial.startsWith(Library.LULU_ENDPOINT))) {
      long expiry = VideoResolver.expiryMillis(initial);
      if (expiry < 0 || expiry > System.currentTimeMillis()) first.resolved = new MultiSource.Result(initial, UserChannels.isPage(first.urls.get(0)) ? first.urls.get(0) : null, getIntent().getStringExtra("initial_referer"));
    }
    layoutTiles(); immersive(); showControls(true);
  }
  private void append(String title, List<String> streams, String target, String channel) {
    if (tiles.size() >= MultiScreen.MAX) return;
    if (target != null && !target.isEmpty()) for (Tile tile : tiles) if (target.equals(tile.target)) return;
    Tile tile = new Tile(title, AppSources.forAndroid(streams), target, channel); tiles.add(tile); if (audible == null) audible = tile;
  }
  private void chooseEvent() {
    if (tiles.size() >= MultiScreen.MAX || picker != null && picker.isShowing()) return;
    systemBars(false);
    List<String> selected = new ArrayList<>(); for (Tile tile : tiles) if (tile.target != null) selected.add(tile.target);
    picker = MultiEventPicker.show(this, selected, event -> {
      int before = tiles.size(); append(event.name, event.streams, AudienceModel.target(true, event.id), event.channelId);
      if (tiles.size() > before) { layoutTiles(); tiles.get(tiles.size() - 1).start(); }
      showControls(true);
    });
    picker.setOnDismissListener(d -> { if (active) { immersive(); showControls(true); } });
  }
  private void removeTile(Tile tile) {
    if (tiles.size() < 2) return;
    tile.stop(); tiles.remove(tile); if (audible == tile) audible = tiles.get(0); layoutTiles(); listen(audible); showControls(true);
  }
  private void layoutTiles() {
    // Detach all frames before moving them to new rows; their players keep playing.
    for (Tile tile : tiles) if (tile.frame.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) tile.frame.getParent()).removeView(tile.frame);
    rows.removeAllViews(); int[] shape = MultiScreen.grid(tiles.size());
    for (int r = 0; r < shape[0]; r++) {
      LinearLayout row = new LinearLayout(this);
      for (int c = 0; c < shape[1]; c++) {
        int i = r * shape[1] + c; View cell = i < tiles.size() ? tiles.get(i).frame : new View(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -1, 1); lp.setMargins(dp(1), dp(1), dp(1), dp(1)); row.addView(cell, lp);
      }
      rows.addView(row, new LinearLayout.LayoutParams(-1, 0, 1));
    }
    if ((getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_TYPE_MASK) != android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
        && MultiScreen.landscape(tiles.size()) && getRequestedOrientation() != ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    addButton.setEnabled(tiles.size() < MultiScreen.MAX); addButton.setText("Añadir evento (" + tiles.size() + "/" + MultiScreen.MAX + ")");
    listen(audible); showControls(controls);
  }
  private void listen(Tile chosen) {
    audible = chosen;
    for (Tile tile : tiles) {
      boolean selected = tile == chosen;
      if (tile.player != null) tile.player.setVolume(selected ? 1f : 0f);
      tile.name.setText((selected ? "🔊 " : "") + tile.title); tile.sound.setText(selected ? "🔊" : "🔇");
      tile.sound.setBackground(Ui.shape(this, selected ? Ui.ACC : 0xa6000000, 26, 2, selected ? Ui.ACC : 0xb3ffffff));
    }
  }
  private void hideIfIdle() {
    if (picker != null && picker.isShowing()) { handler.postDelayed(hide, 4000); return; }
    boolean focused = bar.hasFocus(); for (Tile tile : tiles) focused |= tile.sound.hasFocus() || tile.remove.hasFocus();
    if (!bar.isInTouchMode() && focused) handler.postDelayed(hide, 4000); else showControls(false);
  }
  private void showControls(boolean shown) {
    controls = shown; handler.removeCallbacks(hide); bar.setVisibility(shown ? View.VISIBLE : View.GONE);
    int columns = MultiScreen.grid(tiles.size())[1];
    for (int i = 0; i < tiles.size(); i++) { Tile tile = tiles.get(i); tile.sound.setVisibility(shown ? View.VISIBLE : View.GONE); tile.remove.setVisibility(shown && tiles.size() > 1 ? View.VISIBLE : View.GONE); tile.name.setTranslationY(shown && i < columns ? dp(58) : 0); tile.remove.setTranslationY(shown && i < columns ? dp(58) : 0); tile.viewersBadge.setTranslationY(shown && i < columns ? dp(58) : 0); }
    if (shown) handler.postDelayed(hide, 4000);
  }
  private Runnable stopAccess;
  @Override protected void onStart() {
    super.onStart();
    if (isFinishing()) return;
    if (sleepTimer != null && sleepTimer.resume()) return;
    View content = findViewById(android.R.id.content);
    content.setVisibility(View.INVISIBLE);
    stopAccess = AppAccess.observe(this, state -> {
      if (state == AppAccess.State.ALLOWED && !active) {
        content.setVisibility(View.VISIBLE);
        active = true;
        for (Tile tile : tiles) tile.start();
      } else if (state != AppAccess.State.ALLOWED && (active || state != AppAccess.State.LOADING)) {
        active = false;
        content.setVisibility(View.INVISIBLE);
        finish();
      }
    });
  }
  @Override protected void onStop() { if (sleepTimer != null) sleepTimer.pause(); if (stopAccess != null) { stopAccess.run(); stopAccess = null; } active = false; if (picker != null) { picker.dismiss(); picker = null; } handler.removeCallbacks(hide); for (Tile tile : tiles) tile.stop(); super.onStop(); }
  @Override protected void onDestroy() { if (sleepTimer != null) sleepTimer.close(); handler.removeCallbacksAndMessages(null); worker.shutdownNow(); super.onDestroy(); }
  @Override protected void onSaveInstanceState(Bundle state) {
    if (sleepTimer != null) state.putLong(SleepTimer.DEADLINE, sleepTimer.deadline());
    super.onSaveInstanceState(state);
  }
  @Override public void finish() {
    if (sleepTimer != null) setResult(RESULT_OK, new Intent().putExtra(SleepTimer.DEADLINE, sleepTimer.deadline()));
    super.finish();
  }
  @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused && (picker == null || !picker.isShowing())) immersive(); }
  private int dp(float value) { return Ui.dp(this, value); }
  @SuppressWarnings("deprecation") private void immersive() { systemBars(true); }
  @SuppressWarnings("deprecation") private void systemBars(boolean hidden) {
    Window window = getWindow();
    if (Build.VERSION.SDK_INT >= 30) { WindowInsetsController controller = window.getInsetsController(); if (controller != null) { controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); if (hidden) controller.hide(WindowInsets.Type.systemBars()); else controller.show(WindowInsets.Type.systemBars()); } }
    else window.getDecorView().setSystemUiVisibility(hidden ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN : View.SYSTEM_UI_FLAG_VISIBLE);
  }
}
