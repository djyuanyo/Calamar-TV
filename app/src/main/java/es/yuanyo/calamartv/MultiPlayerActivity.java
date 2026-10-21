package es.yuanyo.calamartv;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Multi-screen: several channels or events at once, as on the web. Two share the screen top and
 * bottom; three or more make a grid on a horizontal screen. Only the tile with sound plays audio. A tap
 * shows the buttons (exit, and a sound button per tile) for a few seconds; only a sound button moves
 * the sound, or on TV the remote's focus. Each tile tries its links in order.
 */
// Same Media3 player settings (resize mode, buffering indicator) as NativePlayerActivity.
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public final class MultiPlayerActivity extends Activity {
  /** Names of the videos, and for each one its links joined by line breaks. */
  static final String TITLES = "titles", STREAMS = "streams";

  private final List<Tile> tiles = new ArrayList<>();
  private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
  private final Runnable hide = () -> showControls(false);
  private LinearLayout bar;
  private boolean controls;
  private int sound;

  private final class Tile {
    final String title;
    final List<String> urls;
    final FrameLayout frame;
    final PlayerView view;
    final TextView name, status, soundButton;
    ExoPlayer player;
    AudienceSession audience;
    long viewers=-1;
    int next;

    Tile(String title, List<String> urls) {
      this.title = title;
      this.urls = urls;
      frame = new FrameLayout(MultiPlayerActivity.this);
      frame.setBackgroundColor(Color.BLACK);
      frame.setFocusable(true);
      frame.setClickable(true);
      frame.setContentDescription(title + ". Pulsa para oír este vídeo");
      frame.setForeground(Ui.focusOutline(MultiPlayerActivity.this, 0));
      view = new PlayerView(MultiPlayerActivity.this);
      view.setUseController(false);
      view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
      view.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
      view.setFocusable(false);
      view.setClickable(false);
      frame.addView(view, new FrameLayout.LayoutParams(-1, -1));
      name = new TextView(MultiPlayerActivity.this);
      name.setTextColor(Color.WHITE);
      name.setTextSize(12);
      name.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
      name.setSingleLine(true);
      name.setPadding(Ui.dp(MultiPlayerActivity.this, 8), Ui.dp(MultiPlayerActivity.this, 3), Ui.dp(MultiPlayerActivity.this, 8), Ui.dp(MultiPlayerActivity.this, 3));
      name.setBackground(Ui.shape(MultiPlayerActivity.this, 0x99000000, 6, 0, 0));
      FrameLayout.LayoutParams np = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START);
      np.setMargins(Ui.dp(MultiPlayerActivity.this, 8), Ui.dp(MultiPlayerActivity.this, 8), Ui.dp(MultiPlayerActivity.this, 8), 0);
      frame.addView(name, np);
      status = new TextView(MultiPlayerActivity.this);
      status.setTextColor(Color.WHITE);
      status.setTextSize(13);
      status.setGravity(Gravity.CENTER);
      frame.addView(status, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
      soundButton = new TextView(MultiPlayerActivity.this);
      soundButton.setGravity(Gravity.CENTER);
      soundButton.setTextSize(22);
      soundButton.setFocusable(true);
      soundButton.setClickable(true);
      soundButton.setVisibility(View.GONE);
      int size = Ui.dp(MultiPlayerActivity.this, 52);
      FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(size, size, Gravity.BOTTOM | Gravity.END);
      sp.setMargins(0, 0, Ui.dp(MultiPlayerActivity.this, 10), Ui.dp(MultiPlayerActivity.this, 10));
      frame.addView(soundButton, sp);
      final int index = tiles.size();
      soundButton.setContentDescription("Oír " + title);
      soundButton.setOnClickListener(v -> { listen(index); showControls(true); });
      // A tap shows or hides the buttons; it never moves the sound (the sound button does).
      frame.setOnClickListener(v -> showControls(!controls));
      // On TV there is no touch: moving to a tile with the remote gives it the sound.
      frame.setOnFocusChangeListener((v, focused) -> { if (focused && !v.isInTouchMode()) listen(index); });
    }

    void start() {
      release();
      if (next >= urls.size()) {
        status.setText("No disponible");
        return;
      }
      String url = urls.get(next++);
      status.setText("Conectando…");
      player = new ExoPlayer.Builder(MultiPlayerActivity.this)
          .setMediaSourceFactory(new DefaultMediaSourceFactory(MultiPlayerActivity.this)
              .setDataSourceFactory(NetworkTransport.get(MultiPlayerActivity.this).mediaFactory(null, false)))
          .build();
      view.setPlayer(player);
      final ExoPlayer instance = player;
      if(audience!=null)audience.open();
      player.addListener(new Player.Listener() {
        @Override public void onIsPlayingChanged(boolean playing){if(instance==player&&audience!=null)audience.watching(playing);}
        @Override public void onPlaybackStateChanged(int state) {
          if (instance == player && state == Player.STATE_READY) status.setText("");
        }

        @Override public void onPlayerError(PlaybackException error) {
          if (instance == player) start(); // Next link of this channel, if any.
        }
      });
      MediaItem.Builder item = new MediaItem.Builder().setUri(url);
      String path = Uri.parse(url).getPath();
      if (path != null && path.endsWith(".m3u8")) item.setMimeType(MimeTypes.APPLICATION_M3U8);
      if (path != null && path.endsWith(".mpd")) item.setMimeType(MimeTypes.APPLICATION_MPD);
      if ("ts".equals(UserChannels.kind(url))) item.setMimeType(MimeTypes.VIDEO_MP2T);
      player.setMediaItem(item.build());
      player.setVolume(tiles.indexOf(this) == sound ? 1f : 0f);
      player.prepare();
      player.play();
    }

    void release() {
      if(audience!=null)audience.close();
      if (player != null) {
        view.setPlayer(null);
        player.release();
        player = null;
      }
    }
  }

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    ArrayList<String> titles = getIntent().getStringArrayListExtra(TITLES);
    ArrayList<String> streams = getIntent().getStringArrayListExtra(STREAMS);
    if (titles == null || streams == null || titles.isEmpty() || titles.size() != streams.size()) {
      finish();
      return;
    }
    int count = Math.min(titles.size(), MultiScreen.MAX);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if (MultiScreen.landscape(count)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    for (int i = 0; i < count; i++) tiles.add(new Tile(titles.get(i), Arrays.asList(streams.get(i).split("\n"))));
    ArrayList<String> targets=getIntent().getStringArrayListExtra("audience_targets"),channels=getIntent().getStringArrayListExtra("audience_channels");
    for(int i=0;i<tiles.size();i++)if(targets!=null&&i<targets.size()&&AudienceModel.validTarget(targets.get(i))){
      final Tile tile=tiles.get(i);String channel=channels!=null&&i<channels.size()?channels.get(i):null;
      tile.audience=new AudienceSession(this,targets.get(i),channel,viewers -> {tile.viewers=viewers;showSound();});
    }
    int[] grid = MultiScreen.grid(count);
    LinearLayout rows = new LinearLayout(this);
    rows.setOrientation(LinearLayout.VERTICAL);
    rows.setBackgroundColor(Color.BLACK);
    int gap = Ui.dp(this, 1);
    for (int r = 0; r < grid[0]; r++) {
      LinearLayout row = new LinearLayout(this);
      for (int c = 0; c < grid[1]; c++) {
        int index = r * grid[1] + c;
        View cell = index < count ? tiles.get(index).frame : new View(this);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -1, 1);
        lp.setMargins(gap, gap, gap, gap);
        row.addView(cell, lp);
      }
      rows.addView(row, new LinearLayout.LayoutParams(-1, 0, 1));
    }
    FrameLayout screen = new FrameLayout(this);
    screen.addView(rows, new FrameLayout.LayoutParams(-1, -1));
    bar = new LinearLayout(this);
    bar.setGravity(Gravity.CENTER_VERTICAL);
    bar.setPadding(Ui.dp(this, 10), Ui.dp(this, 8), Ui.dp(this, 10), Ui.dp(this, 18));
    bar.setBackground(new android.graphics.drawable.GradientDrawable(
        android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0xd9000000, 0x00000000}));
    android.widget.Button exit = Ui.pill(this, "✕ Salir", Ui.Kind.SURFACE, true);
    exit.setOnClickListener(v -> finish());
    bar.addView(exit, new LinearLayout.LayoutParams(-2, Ui.dp(this, 40)));
    TextView hint = new TextView(this);
    hint.setText("Pulsa 🔊 en un vídeo para oírlo");
    hint.setTextColor(Ui.MUTED);
    hint.setTextSize(13);
    hint.setGravity(Gravity.CENTER);
    bar.addView(hint, new LinearLayout.LayoutParams(0, -2, 1));
    bar.setVisibility(View.GONE);
    screen.addView(bar, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
    setContentView(screen);
    immersive();
    showSound();
  }

  @Override
  protected void onStart() {
    super.onStart();
    for (Tile tile : tiles) { tile.next = 0; tile.start(); }
  }

  @Override
  protected void onStop() {
    for (Tile tile : tiles) tile.release();
    super.onStop();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) immersive();
  }

  private void listen(int index) {
    if (index == sound) return;
    sound = index;
    showSound();
  }

  private void showSound() {
    for (int i = 0; i < tiles.size(); i++) {
      Tile tile = tiles.get(i);
      if (tile.player != null) tile.player.setVolume(i == sound ? 1f : 0f);
      tile.name.setText((i == sound ? "🔊 " : "") + tile.title + (tile.audience==null?"":tile.viewers<0?" · ◉ —":" · ◉ "+tile.viewers));
      tile.name.setBackground(Ui.shape(this, i == sound ? Ui.ACC : 0x99000000, 6, 0, 0));
      tile.name.setTextColor(i == sound ? Ui.BG : Color.WHITE);
      tile.soundButton.setText(i == sound ? "🔊" : "🔇");
      tile.soundButton.setBackground(Ui.shape(this, i == sound ? Ui.ACC : 0xa6000000, 26, 2, i == sound ? Ui.ACC : 0xb3ffffff));
    }
  }

  /** The exit bar and the sound buttons, for 4 seconds after a tap. */
  private void showControls(boolean on) {
    controls = on;
    handler.removeCallbacks(hide);
    bar.setVisibility(on ? View.VISIBLE : View.GONE);
    int columns = MultiScreen.grid(tiles.size())[1];
    for (int i = 0; i < tiles.size(); i++) {
      Tile tile = tiles.get(i);
      tile.soundButton.setVisibility(on ? View.VISIBLE : View.GONE);
      // Names of the top row move below the bar while it is shown.
      tile.name.setTranslationY(on && i < columns ? Ui.dp(this, 54) : 0);
    }
    if (on) handler.postDelayed(hide, 4000);
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacks(hide);
    super.onDestroy();
  }

  @SuppressWarnings("deprecation") // setSystemUiVisibility is the way before Android 11.
  private void immersive() {
    Window window = getWindow();
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController controller = window.getInsetsController();
      if (controller == null) return;
      controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      controller.hide(WindowInsets.Type.systemBars());
    } else {
      window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
          | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
          | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
          | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }
  }
}
