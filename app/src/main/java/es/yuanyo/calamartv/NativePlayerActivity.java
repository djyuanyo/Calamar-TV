package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Page -> current media source -> Media3. Signed media URLs are kept in memory only. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public final class NativePlayerActivity extends androidx.appcompat.app.AppCompatActivity {
  private CastControls castControls;
  private boolean castPlayback;
  private Button sourceButton;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final ExecutorService sourceMenuWorker = Executors.newSingleThreadExecutor();
  private final List<VideoResolver.Source> sources = new ArrayList<>();
  private ExoPlayer player;
  private PlayerView playerView;
  private WebView browser;
  private LinearLayout root, panel;
  private FrameLayout stage;
  /** Phones and tablets: the match of an event with a Google match link, under the video. */
  private MatchCenter matchCenter;
  /** The event's own data, shown until (or instead of) ESPN's. */
  private MatchCenter.Model eventModel;
  private TextView status, viewersBadge;
  private AudienceSession audience;
  private final Runnable audiencePlayback=new Runnable(){public void run(){
    if(!matchActive||audience==null)return;
    if(webMode&&browser!=null){final WebView current=browser;current.evaluateJavascript("(function(){var v=document.querySelector('video');return !!v&&!v.paused&&!v.ended&&v.readyState>=3;})()", value -> {if(matchActive&&browser==current&&webMode)audience.watching("true".equals(value));});}
    else audience.watching(castPlayback || player!=null&&player.isPlaying());
    handler.postDelayed(this,10000);
  }};
  private boolean matchActive, matchBusy;
  private final Runnable matchRefresh=new Runnable(){public void run(){
    if(!matchActive)return;
    String id=getIntent().getStringExtra("match_id");
    if(id==null||id.isEmpty())return;
    if(!matchBusy){matchBusy=true;new Thread(() -> {
      MatchCenter.Model model=null;
      try{MatchScores.fetch(id);if(matchCenter!=null)model=MatchCenter.merge(MatchCenter.parse(MatchScores.summary(id)),eventModel);}catch(Exception ignored){}
      final MatchCenter.Model shown=model;
      handler.post(() -> {matchBusy=false;if(matchCenter!=null&&!isFinishing()){if(shown!=null)matchCenter.show(shown);else if(eventModel!=null)matchCenter.failed(eventModel);}});
    }).start();}
    handler.postDelayed(this,30000);
  }};
  @Override protected void onResume(){super.onResume();matchActive=true;handler.removeCallbacks(matchRefresh);handler.post(matchRefresh);if(audience!=null)audience.open();handler.removeCallbacks(audiencePlayback);handler.post(audiencePlayback);}
  @Override protected void onPause(){matchActive=false;handler.removeCallbacks(matchRefresh);handler.removeCallbacks(audiencePlayback);if(audience!=null)audience.close();super.onPause();}
  private boolean fullscreen;
  private NetworkTransport transport;
  private String lastReport = "Aún no se ha consultado la fuente.";
  private boolean diagnosing;
  private boolean mediaHttp1;
  private boolean chromiumNetwork;
  private boolean hostingPlayback;
  private String hostingTriedPage;
  private final List<HostingPlayback.Option> hostingOptions = new ArrayList<>();
  private String hostingSourceId = "";
  private AlertDialog sourceDialog;
  private boolean mediaSystemRetry;
  private Runnable bufferingTimeout;
  private String mediaProgress = "Sin descargas de vídeo registradas.";
  private String pageUrl, documentUrl, currentUrl = "", title, shareUrl;

  /** A user-added media link, played as is without page lookup or renewal. */
  private String directUrl;

  /** All official alternatives for a direct channel; a failing one moves on to the next. */
  private final List<String> directUrls = new ArrayList<>();
  /**
   * The channel's player pages, in catalog order. When every video of one page fails, the next page is
   * tried, and after the pages the direct links (pageIndex past the end means the direct links).
   */
  private final List<String> channelPages = new ArrayList<>();
  private int pageIndex = -1;
  private boolean directTried;

  private int generation, selection, automaticAttempts;
  private long attemptWindow;
  private boolean active, resolving, webMode, footballFallback;

  /** Films and episodes: their «Continuar viendo» entry, where to start, and whether it reached the end. */
  private org.json.JSONObject progressEntry;
  private long resumeMs;
  private boolean ended;
  // «Saltar intro» during the intro set for the series; «Siguiente capítulo» with a 10-second count during
  // the credits (✕ keeps watching them; the next episode still starts when this one ends).
  private static final int NEXT_COUNT = 10;
  private int[] skipMarks;
  private boolean hasNext, nextDismissed;
  private long nextCountAt = -1;
  private Button skipIntroButton, nextButton, nextDismissButton;
  private final Runnable skipTick = new Runnable() { public void run() {
    paintSkip();
    handler.postDelayed(this, 400);
  }};
  private final Runnable progressTick = new Runnable() { public void run() {
    rememberPosition();
    handler.postDelayed(this, 10000);
  }};
  // A planned renewal (the video's token is about to expire) reads the page again for the same video:
  // it is not a failure, so it neither moves to another video nor counts as an attempt.
  private final Runnable renewal = () -> {
    if (!active || resolving || webMode) return;
    status.setText("Renovando la fuente…");
    resolveFresh();
  };

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    MatchScores.initialize(this);
    pageUrl = getIntent().getStringExtra("page_url");
    if (AppSources.webOnly(pageUrl)) pageUrl = null;
    title = getIntent().getStringExtra("title");
    shareUrl = getIntent().getStringExtra("share_url");
    footballFallback = getIntent().getBooleanExtra("football_fallback", false);
    try {
      String entry = getIntent().getStringExtra("progress_entry");
      if (entry != null) progressEntry = new org.json.JSONObject(entry);
    } catch (org.json.JSONException ignored) {
    }
    resumeMs = getIntent().getLongExtra("resume_ms", 0);
    ArrayList<String> urls = getIntent().getStringArrayListExtra("media_urls");
    if (urls == null) urls = new ArrayList<>();
    urls.add(0, getIntent().getStringExtra("media_url"));
    for (String candidate : urls) {
      String url = UserChannels.normalize(candidate);
      if (url != null && !AppSources.webOnly(url) && !directUrls.contains(url)) directUrls.add(url);
    }
    // Channels: player pages among their links are read as pages (one after another), not played as
    // videos. Films keep their single link as it is (a Drive link has no extension either).
    ArrayList<String> everything = getIntent().getStringArrayListExtra("channel_streams");
    if (everything != null) {
      if (pageUrl != null && UserChannels.isPage(pageUrl)) channelPages.add(pageUrl);
      for (String candidate : everything) {
        String url = UserChannels.normalize(candidate);
        if (url == null || AppSources.webOnly(url)) continue;
        if (UserChannels.isPage(url)) { if (!channelPages.contains(url)) channelPages.add(url); }
        else if (!directUrls.contains(url)) directUrls.add(url);
      }
      directUrls.removeIf(UserChannels::isPage);
    }
    // A channel whose first link is a page starts with that page; its direct links wait their turn.
    if (pageUrl == null && !channelPages.isEmpty()) pageUrl = channelPages.get(0);
    boolean startWithPage = everything != null && pageUrl != null;
    directUrl = startWithPage || directUrls.isEmpty() ? null : directUrls.get(0);
    if (directUrl == null && pageUrl == null && !channelPages.isEmpty()) pageUrl = channelPages.get(0);
    pageIndex = directUrl != null ? -1 : channelPages.indexOf(pageUrl);
    directTried = directUrl != null;
    if (directUrl != null) pageUrl = null;
    else if (pageUrl == null || !pageUrl.startsWith("https://")) {
      Toast.makeText(this, "No hay fuentes disponibles para Android", Toast.LENGTH_LONG).show();
      finish();
      return;
    }
    documentUrl = directUrl != null ? directUrl : pageUrl;
    transport = NetworkTransport.get(this);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Ui.BG);
    root.setFitsSystemWindows(true);
    panel = new LinearLayout(this);
    panel.setOrientation(LinearLayout.VERTICAL);

    LinearLayout top = new LinearLayout(this);
    top.setGravity(Gravity.TOP);
    top.setPadding(Ui.dp(this, 8), Ui.dp(this, 6), Ui.dp(this, 14), 0);
    ImageButton back = new ImageButton(this);
    back.setImageDrawable(Ui.icon(Ui.Icon.BACK, Ui.FG, Ui.dp(this, 24)));
    back.setBackground(Ui.focusFill(this, Color.TRANSPARENT, 0x33ffffff, Ui.ACC, 999, 0));
    back.setContentDescription("Volver");
    back.setOnClickListener(v -> finish());
    top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 46), Ui.dp(this, 46)));
    TextView heading = new TextView(this);
    heading.setText(title == null ? "Calamar TV" : title);
    heading.setTextColor(Ui.FG);
    heading.setTextSize(19);
    heading.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
    heading.setSingleLine(true);
    heading.setEllipsize(android.text.TextUtils.TruncateAt.END);
    heading.setPadding(Ui.dp(this, 8), 0, Ui.dp(this, 10), 0);
    top.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));
    FrameLayout header = new FrameLayout(this);
    header.addView(top, new FrameLayout.LayoutParams(-1, -2));
    panel.addView(header);


    LinearLayout controls = new LinearLayout(this);
    controls.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);
    controls.setPadding(Ui.dp(this, 8), Ui.dp(this, 2), Ui.dp(this, 8), Ui.dp(this, 2));
    // Full screen is the video controller's own button (bottom right), as in any player.
    LinearLayout.LayoutParams buttonSize = new LinearLayout.LayoutParams(Ui.dp(this, 44), Ui.dp(this, 40));
    buttonSize.setMargins(Ui.dp(this, 4), Ui.dp(this, 4), Ui.dp(this, 4), Ui.dp(this, 4));
    String audienceTarget=getIntent().getStringExtra("audience_target");
    // Films and series count in the statistics, but their player shows no «people watching».
    if(AudienceModel.validTarget(audienceTarget)&&audienceTarget.startsWith("l:")){
      audience=new AudienceSession(this,audienceTarget,null,null);
    } else if(AudienceModel.validTarget(audienceTarget)){
      viewersBadge=Ui.audienceBadge(this,12);viewersBadge.setContentDescription("Consultando espectadores");
      controls.addView(viewersBadge,new LinearLayout.LayoutParams(-2,-2));
      audience=new AudienceSession(this,audienceTarget,getIntent().getStringExtra("audience_channel"), viewers -> {
        viewersBadge.setText(viewers<0?"—":String.valueOf(viewers));
        viewersBadge.setContentDescription(viewers<0?"Espectadores no disponibles":viewers==1?"1 persona viendo":viewers+" personas viendo");
      });
    }
    sourceButton = button(controls, "Fuentes", this::chooseSource);
    sourceButton.setVisibility(View.VISIBLE);
    // Channels and events, as on the web: their preview link (their card in WhatsApp) through the share sheet.
    if (shareUrl != null) {
      ImageButton shareButton = new ImageButton(this);
      shareButton.setImageDrawable(Ui.icon(Ui.Icon.SHARE, Ui.FG, Ui.dp(this, 22)));
      shareButton.setContentDescription("Compartir");
      shareButton.setPadding(Ui.dp(this, 9), Ui.dp(this, 9), Ui.dp(this, 9), Ui.dp(this, 9));
      shareButton.setBackground(Ui.focusFill(this, Ui.SURFACE, 0xff30352a, Ui.ACC, 999, 0));
      shareButton.setFocusable(true);
      shareButton.setOnClickListener(v -> share());
      controls.addView(shareButton, new LinearLayout.LayoutParams(buttonSize));
    }
    castControls = new CastControls(this, controls,
        // A LuluStream film only plays for whoever opened its page (with its headers): the TV gets the
        // hosting's copy of it, which it can read.
        () -> pageUrl != null && Library.Media.hosting(pageUrl) != null ? Library.Media.hosting(pageUrl)
            : !currentUrl.isEmpty() ? currentUrl
            : directUrls.isEmpty() ? null : directUrls.get(Math.min(selection, directUrls.size() - 1)),
        title, () -> {
          castPlayback = true;
          if(audience!=null)audience.watching(true);
          if (player != null) player.pause();
          if (browser != null) browser.onPause();
          handler.removeCallbacks(renewal);
          handler.removeCallbacks(renewalRequest);
          status.setText("Reproduciendo en Chromecast. Pulsa Compartir pantalla para ver los controles de la TV.");
        },
        // A film or episode goes on on the TV at the minute it is playing here.
        () -> progressEntry == null ? -1 : player == null ? 0 : player.getCurrentPosition());
    HorizontalScrollView scroll = new HorizontalScrollView(this);
    scroll.setHorizontalScrollBarEnabled(false);
    scroll.addView(controls);
    FrameLayout.LayoutParams actions = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.RIGHT);
    actions.leftMargin = Ui.dp(this, 54);
    header.addView(scroll, actions);
    // The buttons sit on the right of the title when there is room for both, otherwise under it.
    header.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
      int buttons = controls.getWidth(), gap = Ui.dp(this, 10);
      boolean beside = header.getWidth() - buttons - Ui.dp(this, 54) >= Ui.dp(this, 160);
      int topMargin = beside ? 0 : Ui.dp(this, 46), right = beside ? buttons + gap : gap;
      if (actions.topMargin == topMargin && heading.getPaddingRight() == right) return;
      header.post(() -> {
        actions.topMargin = topMargin;
        scroll.setLayoutParams(actions);
        heading.setPadding(heading.getPaddingLeft(), heading.getPaddingTop(), right, heading.getPaddingBottom());
      });
    });
    status = new TextView(this);
    status.setTextColor(Ui.ACC);
    status.setTextSize(13);
    status.setPadding(Ui.dp(this, 16), Ui.dp(this, 6), Ui.dp(this, 16), Ui.dp(this, 10));
    // Only messages are shown (loading, problems); while the video plays the line is hidden.
    status.setVisibility(View.GONE);
    status.addTextChangedListener(new android.text.TextWatcher() {
      @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
      @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
      @Override public void afterTextChanged(android.text.Editable s) { status.setVisibility(s.length() == 0 ? View.GONE : View.VISIBLE); }
    });    panel.addView(status);
    root.addView(panel);

    stage = new FrameLayout(this);
    stage.setBackgroundColor(Color.BLACK);
    playerView = new PlayerView(this);
    playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
    playerView.setKeepScreenOn(true);
    playerView.setControllerAutoShow(true);
    playerView.setControllerShowTimeoutMs(0);
    playerView.setControllerHideOnTouch(false);
    // The controller's own full screen button: it hides the panel and the system bars.
    playerView.setFullscreenButtonClickListener(on -> setFullscreen(on));
    // In full screen the panel lies over the video and comes and goes with the controls, as on the web.
    playerView.setControllerVisibilityListener(
        (PlayerView.ControllerVisibilityListener) visibility -> {
          if (fullscreen) panel.setVisibility(visibility == View.VISIBLE ? View.VISIBLE : View.GONE);
        });
    stage.addView(playerView, new FrameLayout.LayoutParams(-1, -1));
    if (progressEntry != null && progressEntry.has("intro_start")) addSkipButtons();
    // On a phone or tablet an event with a Google match link opens in the page, with the match's
    // information, statistics and line-ups under the video; Android TV keeps the full-screen player.
    String matchId = getIntent().getStringExtra("match_id"), info = getIntent().getStringExtra("event_info");
    boolean linked = matchId != null && !matchId.isEmpty();
    // An event without a match link opens in full screen, with no match data.
    if (linked && !isTelevision()) {
      matchCenter = new MatchCenter(this);
      try { eventModel = MatchCenter.fromEvent(new org.json.JSONObject(info == null ? "{}" : info)); }
      catch (org.json.JSONException broken) { eventModel = MatchCenter.fromEvent(new org.json.JSONObject()); }
      if (linked) eventModel.note = "Cargando los datos del partido…";
      matchCenter.show(eventModel);
      if (linked) eventModel.note = "";
    }
    root.addView(stage, stageSize(false));
    if (matchCenter != null) root.addView(matchCenter.view, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(root);
    // Channels and events open in full screen; the controller's button shows the panel again, and
    // Back closes the player straight away instead of first leaving full screen.
    if (matchCenter == null) setFullscreen(true);
  }

  private Button button(LinearLayout row, String text, Runnable action) {
    Button b = Ui.pill(this, text, Ui.Kind.SURFACE, true);
    b.setTextSize(12);
    b.setPadding(Ui.dp(this, 10), 0, Ui.dp(this, 10), 0);
    b.setFocusable(true);
    b.setOnClickListener(v -> action.run());
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, Ui.dp(this, 40));
    p.setMargins(Ui.dp(this, 4), Ui.dp(this, 4), Ui.dp(this, 4), Ui.dp(this, 4));
    row.addView(b, p);
    return b;
  }

  private void keepControlsVisible(boolean loading) {
    if (playerView == null || (sourceDialog != null && sourceDialog.isShowing())) return;
    playerView.setControllerShowTimeoutMs(loading ? 0 : 4000);
    playerView.setControllerHideOnTouch(!loading);
    if (loading) {
      playerView.showController();
      if (fullscreen && panel != null) panel.setVisibility(View.VISIBLE);
    }
  }

  private void updateSourceButton() {
    if (sourceButton != null) sourceButton.setVisibility(View.VISIBLE);
  }

  // ---- Full screen ----------------------------------------------------------------------------

  private boolean isTelevision() {
    return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_TYPE_MASK)
        == Configuration.UI_MODE_TYPE_TELEVISION;
  }

  /** The video fills the screen, or with the match under it a 16:9 box at the top. */
  private LinearLayout.LayoutParams stageSize(boolean full) {
    if (matchCenter == null || full) return new LinearLayout.LayoutParams(-1, 0, 1);
    android.util.DisplayMetrics d = getResources().getDisplayMetrics();
    return new LinearLayout.LayoutParams(-1, Math.min(d.widthPixels * 9 / 16, d.heightPixels * 3 / 4));
  }

  @Override
  public void onConfigurationChanged(Configuration change) {
    super.onConfigurationChanged(change);
    if (matchCenter != null && stage != null) stage.setLayoutParams(stageSize(fullscreen));
  }

  /** Full screen: the panel and the system bars go away, and a phone turns to landscape. */
  private void setFullscreen(boolean on) {
    if (fullscreen == on) return; // The controller reports back what we set; this stops the echo.
    fullscreen = on;
    if (matchCenter != null) {
      matchCenter.view.setVisibility(on ? View.GONE : View.VISIBLE);
      stage.setLayoutParams(stageSize(on));
    }
    placePanel(on);
    root.setFitsSystemWindows(!on);
    // The bars' padding stays on the view after it stops fitting them: clear it so the video fills the
    // screen (leaving full screen fits the bars again and puts it back).
    if (on) root.setPadding(0, 0, 0, 0);
    applySystemBars(on);
    if (!isTelevision()) {
      setRequestedOrientation(
          on
              ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
              : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }
    playerView.setFullscreenButtonState(on);
    root.requestApplyInsets();
  }

  /**
   * Outside full screen the panel sits above the video; in full screen it lies over the top of the
   * video on a dark fade and shows only while the player controls do (a tap shows both).
   */
  private void placePanel(boolean overlay) {
    android.view.ViewGroup parent = (android.view.ViewGroup) panel.getParent();
    if (parent != null) parent.removeView(panel);
    if (overlay) {
      panel.setBackground(new android.graphics.drawable.GradientDrawable(
          android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM, new int[] {0xd9000000, 0x00000000}));
      panel.setPadding(0, Ui.dp(this, 6), 0, Ui.dp(this, 18));
      stage.addView(panel, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
      panel.setVisibility(playerView.isControllerFullyVisible() ? View.VISIBLE : View.GONE);
    } else {
      panel.setBackground(null);
      panel.setPadding(0, 0, 0, 0);
      root.addView(panel, 0);
      panel.setVisibility(View.VISIBLE);
    }
  }

  private void share() {
    Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
        .putExtra(Intent.EXTRA_SUBJECT, title)
        .putExtra(Intent.EXTRA_TEXT, shareUrl);
    try { startActivity(Intent.createChooser(send, "Compartir " + (title == null ? "evento" : title))); }
    catch (android.content.ActivityNotFoundException none) { Toast.makeText(this, shareUrl, Toast.LENGTH_LONG).show(); }
  }

  @SuppressWarnings("deprecation") // setSystemUiVisibility is the way before Android 11.
  private void applySystemBars(boolean immersive) {
    Window window = getWindow();
    if (Build.VERSION.SDK_INT >= 28) {
      WindowManager.LayoutParams attributes = window.getAttributes();
      // In full screen the video also uses the camera notch side, as a browser does in full screen.
      attributes.layoutInDisplayCutoutMode =
          !immersive
              ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
              : Build.VERSION.SDK_INT >= 30
                  ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                  : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      window.setAttributes(attributes);
    }
    if (Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController controller = window.getInsetsController();
      if (controller == null) return;
      if (immersive) {
        controller.setSystemBarsBehavior(
            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsets.Type.systemBars());
      } else {
        controller.show(WindowInsets.Type.systemBars());
      }
    } else {
      window
          .getDecorView()
          .setSystemUiVisibility(
              immersive
                  ? View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                      | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                      | View.SYSTEM_UI_FLAG_FULLSCREEN
                      | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                      | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                      | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                  : View.SYSTEM_UI_FLAG_VISIBLE);
    }
  }

  /** Something the viewer has to read: the panel is hidden in full screen, so leave it first. */
  private void problem(String text) {
    keepControlsVisible(true);
    status.setText(text);
    setFullscreen(false);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    // The system shows its bars again when another app was in front; hide them once more.
    if (hasFocus && fullscreen && (sourceDialog == null || !sourceDialog.isShowing())) applySystemBars(true);
  }

  private void chooseDns() {
    if (!active || isFinishing()) return;
    final boolean restoreFullscreen = fullscreen;
    if (restoreFullscreen) applySystemBars(false);
    DnsProvider[] providers = DnsProvider.values();
    String[] names = new String[providers.length];
    for (int i = 0; i < providers.length; i++) names[i] = providers[i].label;
    AlertDialog dnsDialog = new AlertDialog.Builder(this)
        .setTitle("DNS del reproductor")
        .setSingleChoiceItems(
            names,
            transport.provider.ordinal(),
            (dialog, index) -> {
              NetworkTransport.select(this, providers[index]);
              transport = NetworkTransport.get(this);
              mediaHttp1 = false;
              mediaSystemRetry = false;
              chromiumNetwork = false;
              generation++;
              resolving = false;
              automaticAttempts = 0;
              handler.removeCallbacks(renewal);
              handler.removeCallbacks(renewalRequest);
              releasePlayer();
              dialog.dismiss();
              resolveFresh();
            })
        .setNegativeButton("Cerrar", null)
        .create();
    dnsDialog.setOnDismissListener(dialog -> {
      if (active && restoreFullscreen) applySystemBars(true);
    });
    dnsDialog.show();
  }

  @Override
  protected void onStart() {
    super.onStart();
    active = true;
    if (castPlayback && castControls != null && castControls.connected()) {
      status.setText("Reproduciendo en Chromecast. Pulsa Compartir pantalla para ver los controles de la TV.");
      return;
    }
    castPlayback = false;
    if (progressEntry != null) { handler.removeCallbacks(progressTick); handler.postDelayed(progressTick, 10000); }
    if (directUrl != null && webMode) openDirectWeb();
    else if (directUrl != null) playDirect();
    else if (pageUrl != null) resolveFresh();
  }

  private void playDirect() {
    if (!active) return;
    webMode = false;
    clearWeb();
    lastReport = reportHeader();
    handler.removeCallbacks(renewalRequest);
    sources.clear();
    String name = title == null ? "Mi canal" : title;
    for (int i = 0; i < directUrls.size(); i++)
      sources.add(
          new VideoResolver.Source(
              directUrls.size() > 1 ? name + " · fuente " + (i + 1) : name, directUrls.get(i)));
    updateSourceButton();
    selection = Math.min(selection, sources.size() - 1);
    VideoResolver.Source source = sources.get(selection);
    status.setText("Conectando con " + HostingPlayback.label(title, "el canal") + "…");
    releasePlayer();
    playSource(source);
  }

  private void resolveFresh() {
    if (!active || resolving) return;
    keepControlsVisible(true);
    if (directUrl != null) {
      playDirect();
      return;
    }
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
      updateSourceButton();
      playSource(sources.get(0));
      return;
    }
    final String requestedPage = pageUrl;
    if (zicoPage()) hostingPlayback = true;
    final boolean throughHosting = hostingPlayback;
    final String requestedSignal = hostingSourceId.isEmpty() ? HostingPlayback.AUTOMATIC : hostingSourceId;
    final int requestedAttempt = automaticAttempts;
    final String channelName = HostingPlayback.label(eventSourceNames.get(requestedPage), HostingPlayback.label(title, "Canal"));
    String signalName = channelName;
    for (HostingPlayback.Option option : hostingOptions) if (option.id.equals(requestedSignal)) signalName = option.name;
    final String requestedName = signalName;
    if (throughHosting && VideoResolver.eventApi(requestedPage) == null) loadHostingMenu(requestedPage, channelName, request);
    worker.execute(
        () -> {
          try {
            NetworkTransport pageTransport = mediaSystemRetry ? NetworkTransport.get(DnsProvider.SYSTEM) : transport;
            String eventApi = VideoResolver.eventApi(requestedPage);
            if (throughHosting && eventApi == null) {
              // Start exactly as 2.20.55: one request lets the hosting try every available signal.
              // The optional menu runs independently; it cannot stop a working video from opening.
              String address = HostingPlayback.resolve(requestedPage, requestedSignal, requestedAttempt, NetworkTransport.get(DnsProvider.SYSTEM));
              handler.post(() -> {
                if (!active || request != generation) return;
                resolving = false;
                documentUrl = Library.PLAYER_ENDPOINT;
                chromiumNetwork = false;
                lastReport = reportHeader() + "\nHosting: lista HLS firmada recibida";
                sources.clear();
                hostingSourceId = requestedSignal;
                sources.add(new VideoResolver.Source(requestedName, address));
                selection = 0; updateSourceButton(); playSource(sources.get(0));
              });
              return;
            }
            if (eventApi != null) {
              PlayerDocument.Result event;
              if (throughHosting) {
                String endpoint = Library.PLAYER_ENDPOINT + "?event=" + Uri.encode(requestedPage);
                event = PlayerDocument.fetch(endpoint, NetworkTransport.get(DnsProvider.SYSTEM));
              } else try {
                event = PlayerDocument.fetch(eventApi, pageTransport.pageFactory(true),
                    NetworkTransport.get(DnsProvider.SYSTEM).pageFactory(true));
              } catch (java.io.IOException blocked) {
                if (blocked instanceof PlayerDocument.HttpFailure) throw blocked;
                event = PlayerDocument.fetch(eventApi, ChromiumNetwork.get(this));
                chromiumNetwork = true;
              }
              List<VideoResolver.Source> players = VideoResolver.eventPlayers(event.html);
              if (players.isEmpty()) throw new java.io.IOException("El evento todavía no publica fuentes disponibles");
              handler.post(() -> {
                if (!active || request != generation) return;
                resolving = false;
                int at = Math.max(0, channelPages.indexOf(requestedPage));
                channelPages.remove(requestedPage);
                for (VideoResolver.Source source : players) {
                  if (!channelPages.contains(source.url)) channelPages.add(Math.min(Math.max(0, at++), channelPages.size()), source.url);
                  eventSourceNames.put(source.url, source.label);
                }
                pageUrl = players.get(0).url; pageIndex = channelPages.indexOf(pageUrl); selection = 0; hostingOptions.clear(); hostingSourceId = "";
                documentUrl = pageUrl; updateSourceButton(); resolveFresh();
              });
              return;
            }
            boolean usedChromium = chromiumNetwork;
            PlayerDocument.Result fetched;
            if (usedChromium) fetched = PlayerDocument.fetch(requestedPage, ChromiumNetwork.get(this));
            else {
              try {
                fetched = PlayerDocument.fetch(requestedPage, pageTransport.pageFactory(mediaHttp1),
                    mediaHttp1 ? null : pageTransport.pageFactory(true),
                    pageTransport.provider == DnsProvider.SYSTEM ? null : NetworkTransport.get(DnsProvider.SYSTEM).pageFactory(true));
              } catch (java.io.IOException failure) {
                if (failure instanceof PlayerDocument.HttpFailure || !VideoResolver.renewablePage(requestedPage)) throw failure;
                handler.post(() -> { if (active && generation == request) { chromiumNetwork = true; status.setText("Probando la conexión Chromium…"); } });
                fetched = PlayerDocument.fetch(requestedPage, ChromiumNetwork.get(this));
                usedChromium = true;
              }
            }
            final PlayerDocument.Result document = fetched;
            final boolean documentChromium = usedChromium;
            List<VideoResolver.Source> found = VideoResolver.parse(document.html, document.url);
            found.removeIf(source -> AppSources.webOnly(source.url));
            handler.post(
                () -> {
                  if (!active || request != generation) return;
                  resolving = false;
                  documentUrl = document.url;
                  chromiumNetwork = documentChromium;
                  if (document.usedFallback) mediaSystemRetry = true;
                  if (document.usedHttp1) mediaHttp1 = true;
                  lastReport =
                      reportHeader() + "\nPágina: HTTP 200\nFuentes compatibles: " + found.size();
                  String previousSource = selection >= 0 && selection < sources.size() ? sources.get(selection).url : null;
                  sources.clear();
                  sources.addAll(found);
                  // Zico has an explicit hosting route in the picker and after device failures.
                  if (channelPage() && !VideoResolver.renewablePage(pageUrl) && !sources.isEmpty())
                    sources.add(new VideoResolver.Source("Por el hosting", Library.playerRelay(pageUrl)));
                  updateSourceButton();
                  if (sources.isEmpty() && VideoResolver.processing(document.html)) {
                    // A video just uploaded to LuluStream plays once LuluStream has converted it.
                    problem("Este vídeo todavía se está procesando en LuluStream. Prueba de nuevo en un rato.");
                  } else if (sources.isEmpty() && Library.Media.hosting(pageUrl) != null) {
                    playThroughHosting();
                  } else if (sources.isEmpty() && VideoResolver.renewablePage(pageUrl)) {
                    if (!tryNextZicoSource()) problem("No hay señales disponibles para este canal.");
                  } else if (sources.isEmpty()) {
                    openWeb();
                    status.setText("Pulsa ▶ en la página para detectar un vídeo compatible.");
                  } else {
                    selection = VideoResolver.renewedSelection(sources, previousSource, selection);
                    playSource(sources.get(selection));
                  }
                });
          } catch (Exception failure) {
            handler.post(
                () -> {
                  if (!active || request != generation) return;
                  resolving = false;
                  String reason = ConnectionReport.describe(failure);
                  if (throughHosting) reason = failure.getMessage();
                  lastReport = reportHeader() + "\nConsulta de página: " + reason;
                  if (player != null && player.isPlaying()) {
                    status.setText(
                        "No se pudo renovar. La emisión actual continúa; reintentando…");
                    handler.removeCallbacks(renewal);
                    handler.postDelayed(renewal, 15000L);
                  } else if (throughHosting) {
                    if (HostingPlayback.AUTOMATIC.equals(requestedSignal))
                      refreshAutomatically("El servidor no ha encontrado vídeo todavía. Reintentando con otra señal…");
                    else problem("No se pudo abrir esta señal. Elige otra en Fuentes o pulsa Reintentar.");
                  } else if (Library.Media.hosting(pageUrl) != null) {
                    // LuluStream refused this device its page: the hosting reads it, as for the web.
                    playThroughHosting();
                  } else if (tryHosting() || (zicoPage() && switchChannelSource())) {
                    return;
                  } else if (VideoResolver.renewablePage(pageUrl) || VideoResolver.eventApi(pageUrl) != null) {
                    refreshAutomatically("No se pudo consultar la fuente (" + reason + "). Reintentando…");
                  } else if (channelPage()) {
                    // The page cannot be reached from this phone (blocked by the operator): the hosting.
                    sources.clear();
                    sources.add(new VideoResolver.Source("Por el hosting", Library.playerRelay(pageUrl)));
                    selection = 0;
                    updateSourceButton();
                    playSource(sources.get(0));
                  } else if (footballFallback) {
                    openWeb();
                    status.setText("No hay fuente directa. Reproduciendo desde el proveedor.");
                  } else {
                    problem(
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

  /** A player page of a catalog channel, which the hosting reads (not LuluStream, it has its own file). */
  private boolean channelPage() {
    return pageUrl != null && channelPages.contains(pageUrl) && Library.Media.hosting(pageUrl) == null;
  }

  /** Metadata must not delay or reject the automatic hosting route that was used in 2.20.55. */
  private void loadHostingMenu(String page, String channel, int request) {
    sourceMenuWorker.execute(() -> {
      try {
        List<HostingPlayback.Option> menu = HostingPlayback.options(page, channel, NetworkTransport.get(DnsProvider.SYSTEM));
        handler.post(() -> {
          if (!active || generation != request || !page.equals(pageUrl)) return;
          hostingOptions.clear(); hostingOptions.addAll(menu);
          updateSourceButton();
        });
      } catch (java.io.IOException unavailable) { /* Playback continues through the automatic route. */ }
    });
  }

  /** A LuluStream video through the hosting (calamar-lulu.php), when this device cannot read its page. */
  private void playThroughHosting() {
    sources.clear();
    sources.add(new VideoResolver.Source("LuluStream por el hosting", Library.Media.hosting(pageUrl)));
    selection = 0;
    updateSourceButton();
    playSource(sources.get(0));
  }

  private final java.util.Map<String,String> eventSourceNames = new java.util.HashMap<>();

  private void playSource(VideoResolver.Source source) {
    if (!active) return;
    castPlayback = false;
    long expiry = directUrl != null ? -1 : VideoResolver.expiryMillis(source.url);
    if (expiry > 0 && expiry <= System.currentTimeMillis()) {
      refreshAutomatically("El proveedor devolvió un enlace caducado. Solicitando uno nuevo…");
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
    DataSource.Factory http;
    try {
      if (chromiumNetwork && ("hls".equals(UserChannels.kind(source.url)) || source.url.startsWith(Library.PLAYER_ENDPOINT)
          || source.url.startsWith(Library.LULU_ENDPOINT))) http = ChromiumNetwork.get(this).mediaFactory(directUrl != null ? null : mediaReferer());
      else {
        http =
            (mediaSystemRetry ? NetworkTransport.get(DnsProvider.SYSTEM) : transport)
            .mediaFactory(directUrl != null ? null : mediaReferer(), mediaHttp1, source.url,
                directUrl == null && pageUrl != null
                    && !source.url.startsWith(Library.LULU_ENDPOINT) && !source.url.startsWith(Library.PLAYER_ENDPOINT));
      }
    } catch (java.io.IOException failure) {
      problem("No se pudo iniciar la conexión Chromium. " + ConnectionReport.describe(failure));
      return;
    }
    mediaProgress =
        "Esperando la lista y los fragmentos · HTTP " + (mediaHttp1 ? "1.1" : "automático");
    lastReport += "\nIntento de reproducción: HTTP " + (mediaHttp1 ? "1.1" : "automático");
    player =
        new ExoPlayer.Builder(this)
            // Up to 30 s ahead (it starts after 2.5 s): with only 5 s, a slow piece from a distant
            // server stopped the picture.
            .setLoadControl(new DefaultLoadControl.Builder()
                .setBufferDurationsMs(12000, 30000, 2500, 5000)
                .setTargetBufferBytes(isTelevision() ? 16 * 1024 * 1024 : 32 * 1024 * 1024)
                .setPrioritizeTimeOverSizeThresholds(false).build())
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
    player.addAnalyticsListener(
        new androidx.media3.exoplayer.analytics.AnalyticsListener() {
          @Override
          public void onLoadCompleted(
              EventTime eventTime,
              androidx.media3.exoplayer.source.LoadEventInfo info,
              androidx.media3.exoplayer.source.MediaLoadData data) {
            if (instance != player || !active) return;
            String phase =
                data.dataType == androidx.media3.common.C.DATA_TYPE_MANIFEST
                    ? "Lista HLS"
                    : "Fragmento/datos";
            mediaProgress =
                phase + " descargado · " + info.uri.getHost() + " · " + info.bytesLoaded + " bytes";
          }

          @Override
          public void onLoadError(
              EventTime eventTime,
              androidx.media3.exoplayer.source.LoadEventInfo info,
              androidx.media3.exoplayer.source.MediaLoadData data,
              java.io.IOException error,
              boolean wasCanceled) {
            if (instance != player || !active || wasCanceled) return;
            String phase =
                data.dataType == androidx.media3.common.C.DATA_TYPE_MANIFEST
                    ? "Lista HLS"
                    : "Fragmento/datos";
            mediaProgress =
                phase + " falló · " + info.uri.getHost() + " · " + ConnectionReport.describe(error);
          }
        });
    player.addListener(
        new Player.Listener() {
          @Override public void onIsPlayingChanged(boolean playing){if(instance==player&&audience!=null&&matchActive)audience.watching(castPlayback||playing);}
          @Override
          public void onPlaybackStateChanged(int state) {
            if (instance != player || !active) return;
            if (state == Player.STATE_READY) {
              cancelBufferingTimeout();
              keepControlsVisible(false);
              automaticAttempts = 0;
              status.setText("");
            } else if (state == Player.STATE_BUFFERING) {
              keepControlsVisible(true);
              status.setText("Cargando vídeo…");
              armBufferingTimeout(instance, source);
            } else if (state == Player.STATE_ENDED && progressEntry != null) {
              endEpisode();
            } else cancelBufferingTimeout();
          }

          @Override
          public void onPlayerError(PlaybackException error) {
            if (instance != player || !active) return;
            String detail = ConnectionReport.describe(error);
            for (Throwable cause = error; cause != null; cause = cause.getCause()) {
              if (cause
                  instanceof
                  androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) {
                detail =
                    "HTTP "
                        + ((androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException)
                                cause)
                            .responseCode;
                break;
              }
            }
            lastReport += "\nVídeo: " + error.getErrorCodeName() + " · " + detail;
            lastReport += "\n" + mediaProgress;
            cancelBufferingTimeout();
            if (error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
                || error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT || detail.contains("RESET")) {
              if (retryChromiumNetwork(source) || retrySystemNetwork(source) || tryNextZicoSource()) return;
            }
            if (directUrl != null
                && BrowserPlayback.supports(source.url)
                && !mediaHttp1
                && error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED) {
              mediaHttp1 = true;
              status.setText("Reintentando la conexión de vídeo con HTTP/1.1…");
              playSource(source);
              return;
            }
            if (directUrl != null && BrowserPlayback.supports(source.url)) {
              openDirectWeb();
              status.setText(
                  "La reproducción nativa falló (" + detail + "). Probando el reproductor web…");
              return;
            }
            problem("No se pudo reproducir (" + error.getErrorCodeName() + " · " + detail + ").");
            refreshAutomatically("Reconectando con una fuente vigente…");
          }
        });
    MediaItem.Builder item = new MediaItem.Builder().setUri(source.url);
    String path = Uri.parse(source.url).getPath();
    if ((path != null && path.endsWith(".m3u8")) || source.url.startsWith(Library.LULU_ENDPOINT) || source.url.startsWith(Library.PLAYER_ENDPOINT)) item.setMimeType(MimeTypes.APPLICATION_M3U8);
    if (path != null && path.endsWith(".mpd")) item.setMimeType(MimeTypes.APPLICATION_MPD);
    if ("ts".equals(UserChannels.kind(source.url)) || CastSource.needsBridge(source.url)) item.setMimeType(MimeTypes.VIDEO_MP2T);
    currentUrl = source.url;
    player.setMediaItem(item.build());
    if (progressEntry != null && resumeMs > 0) player.seekTo(resumeMs);
    player.prepare();
    player.play();
    playerView.requestFocus();
    scheduleRenewal(source.url);
  }

  private void cancelBufferingTimeout() {
    if (bufferingTimeout != null) handler.removeCallbacks(bufferingTimeout);
    bufferingTimeout = null;
  }

  private void armBufferingTimeout(ExoPlayer instance, VideoResolver.Source source) {
    cancelBufferingTimeout();
    bufferingTimeout = () -> {
      if (!active || player != instance || !instance.getPlayWhenReady()
          || instance.getPlaybackState() != Player.STATE_BUFFERING) return;
      lastReport += "\nVídeo: 25 segundos sin completar el búfer.\n" + mediaProgress;
      if (retryChromiumNetwork(source) || retrySystemNetwork(source) || tryNextZicoSource()) return;
      if (directUrl != null && BrowserPlayback.supports(source.url)) {
        openDirectWeb();
        status.setText("La conexión nativa no responde. Probando el reproductor web…");
      } else {
        problem("La fuente no responde. Prueba otra opción en Fuentes o vuelve a abrir el canal.");
        releasePlayer();
        refreshAutomatically("Probando otra conexión…");
      }
    };
    handler.postDelayed(bufferingTimeout, 25000);
  }

  private boolean zicoPage() {
    return directUrl == null && (VideoResolver.renewablePage(pageUrl) || VideoResolver.eventApi(pageUrl) != null);
  }

  private boolean tryNextZicoSource() {
    return zicoPage() && (tryHosting() || switchChannelSource());
  }

  /** One hosting attempt per page; renewals continue through the selected route. */
  private boolean tryHosting() {
    if (!zicoPage() || hostingPlayback || pageUrl.equals(hostingTriedPage)) return false;
    hostingPlayback = true; hostingTriedPage = pageUrl;
    releasePlayer();
    status.setText("Conectando con la señal del canal…");
    resolveFresh();
    return true;
  }

  private boolean retryChromiumNetwork(VideoResolver.Source source) {
    if (hostingPlayback || chromiumNetwork || !VideoResolver.renewablePage(pageUrl)) return false;
    chromiumNetwork = true;
    status.setText("Reconectando con el motor de red Chromium…");
    lastReport += "\nReintento: Chromium (conexión del dispositivo)";
    releasePlayer();
    resolveFresh();
    return true;
  }

  /** A failed private DNS must not leave working device connections waiting indefinitely. */
  private boolean retrySystemNetwork(VideoResolver.Source source) {
    if (hostingPlayback || mediaSystemRetry || transport.provider == DnsProvider.SYSTEM) return false;
    mediaSystemRetry = true;
    mediaHttp1 = true;
    status.setText("Reintentando con la conexión del dispositivo…");
    lastReport += "\nReintento: DNS del sistema · HTTP/1.1";
    // Release first: a previously playing instance must not short-circuit the retry.
    releasePlayer();
    // A page-issued URL belongs to the connection that obtained it. Read it again after changing networks.
    if (directUrl == null && VideoResolver.renewablePage(pageUrl)) resolveFresh();
    else playSource(source);
    return true;
  }

  private void scheduleRenewal(String address) {
    handler.removeCallbacks(renewal);
    // There is no page to re-resolve for a raw URL.
    if (directUrl != null || VideoResolver.isMedia(pageUrl)) return;
    long delay = VideoResolver.pageRenewalDelay(pageUrl, address, System.currentTimeMillis());
    if (delay >= 0) handler.postDelayed(renewal, delay);
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
    if (directUrl == null && VideoResolver.renewablePage(pageUrl)) {
      if (automaticAttempts >= 3) {
        if (tryHosting()) return;
        hostingPlayback = false;
        if (switchChannelSource()) return;
        problem("No se pudo conectar con esta fuente desde tu red. Prueba otra fuente en Fuentes.");
        return;
      }
      if (sources.size() > 1) selection = (selection + 1) % sources.size();
      long delay = Math.min(30000L, 1500L << Math.min(5, automaticAttempts++));
      status.setText(message);
      handler.removeCallbacks(renewalRequest);
      handler.postDelayed(renewalRequest, delay);
      return;
    }
    // Direct channels with alternatives try each source before giving up; a player page with several
    // videos (CDN 1, CDN 2…) moves on to its next video, as the page is read again.
    if (directUrl != null && directUrls.size() > 1) selection = (selection + 1) % directUrls.size();
    else if (directUrl == null && sources.size() > 1) selection = (selection + 1) % sources.size();
    int limit = Math.max(3, Math.max(directUrls.size(), sources.size()));
    if (++automaticAttempts > limit || (directUrl == null && VideoResolver.isMedia(pageUrl))) {
      // Every video of this source failed: the channel's next source, if it has one.
      if (switchChannelSource()) return;
      if (footballFallback && directUrl == null) {
        openWeb();
        status.setText("La fuente directa falló. Modo web del proveedor.");
        return;
      }
      problem(
          directUrl != null
              ? "No se pudo reproducir el enlace. Comprueba el enlace o vuelve a abrir el canal."
              : "No se pudo recuperar la emisión. Prueba otra opción en Fuentes o vuelve a abrir el canal.");
      return;
    }
    status.setText(message);
    handler.postDelayed(renewalRequest, 1500);
  }

  private final Runnable renewalRequest = this::resolveFresh;

  /** Moves to the channel's next player page, or after the pages to its direct links; false when none is left. */
  private boolean switchChannelSource() {
    if (pageIndex + 1 < channelPages.size()) {
      pageIndex++;
      directUrl = null;
      pageUrl = channelPages.get(pageIndex);
      documentUrl = pageUrl;
    } else if (!directTried && !directUrls.isEmpty()) {
      directTried = true;
      pageIndex = channelPages.size();
      directUrl = directUrls.get(0);
      pageUrl = null;
      documentUrl = directUrl;
    } else return false;
    hostingPlayback = false; hostingTriedPage = null; hostingOptions.clear(); hostingSourceId = "";
    automaticAttempts = 0;
    attemptWindow = android.os.SystemClock.elapsedRealtime();
    selection = 0;
    sources.clear();
    status.setText("Esta fuente no responde. Probando la siguiente fuente del canal…");
    handler.postDelayed(renewalRequest, 1500);
    return true;
  }

  private String reportHeader() {
    Uri page = Uri.parse(directUrl != null ? directUrl : pageUrl);
    return "Calamar TV " + BuildConfig.VERSION_NAME + "\nAndroid API "
        + android.os.Build.VERSION.SDK_INT
        + "\nPágina: "
        + page.getHost()
        + (directUrl != null ? "" : page.getPath())
        + "\nMotor: "
        + (chromiumNetwork ? "Chromium · conexión del dispositivo" : transport.name())
        + "\nRuta: " + (hostingPlayback ? "servidor de Calamar TV" : "conexión del dispositivo");
  }

  private void diagnose() {
    diagnoseAddress(directUrl != null ? directUrl : pageUrl);
  }

  private void diagnoseAddress(String address) {
    if (diagnosing) return;
    diagnosing = true;
    final String target = address;
    final String previous =
        lastReport
            + "\n"
            + mediaProgress
            + "\nModo: "
            + (webMode ? "web" : "nativo")
            + (player == null
                ? ""
                : " · estado "
                    + player.getPlaybackState()
                    + " · búfer "
                    + player.getTotalBufferedDuration()
                    + " ms");
    status.setText("Comparando la conexión de los motores. Espera unos segundos…");
    new Thread(
        () -> {
          String report = previous + "\n\nComprobando: " + android.net.Uri.parse(target).getHost() + (VideoResolver.renewablePage(target) || VideoResolver.eventApi(target) != null ? android.net.Uri.parse(target).getPath() : " · enlace directo") + "\nPrueba sin cambiar la red del dispositivo:\n";
          report += probe("Sistema", target, url -> (java.net.HttpURLConnection) url.openConnection());
          report += "\n" + probe(transport.name(), target, transport);
          try { report += "\n" + probe("Chromium", target, ChromiumNetwork.get(this)); }
          catch (java.io.IOException failure) { report += "\nChromium: " + ConnectionReport.describe(failure); }
          final String result = report;
          handler.post(
              () -> {
                diagnosing = false;
                if (!active || isFinishing()) return;
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
        }, "Calamar-diagnostico").start();
  }

  private String probe(String name, String target, PlayerDocument.ConnectionFactory factory) {
    long start = android.os.SystemClock.elapsedRealtime();
    try {
      if (VideoResolver.isMedia(target) || target.equals(directUrl)) {
        java.net.HttpURLConnection connection = factory.open(new java.net.URL(target));
        try {
          connection.setConnectTimeout(10000);
          connection.setReadTimeout(10000);
          connection.setRequestProperty("Range", "bytes=0-1023");
          return name + ": HTTP " + connection.getResponseCode();
        } finally {
          connection.disconnect();
        }
      }
      PlayerDocument.Result result = PlayerDocument.fetch(target, factory);
      java.util.List<VideoResolver.Source> found = VideoResolver.parse(result.html, result.url);
      int count = found.size();
      return name
          + ": HTTP 200 · "
          + count
          + " fuentes · "
          + (android.os.SystemClock.elapsedRealtime() - start)
          + " ms" + (found.isEmpty() ? "" : "\n  Primer M3U8: " + probeMedia(found.get(0).url, result.url, factory));
    } catch (Exception failure) {
      return name + ": " + ConnectionReport.describe(failure);
    }
  }

  private String probeMedia(String address, String referer, PlayerDocument.ConnectionFactory factory) {
    try {
      java.net.HttpURLConnection c = factory.open(new java.net.URL(address));
      try {
        c.setConnectTimeout(10000); c.setReadTimeout(10000);
        c.setRequestProperty("User-Agent", PlayerDocument.BROWSER_USER_AGENT);
        Uri page = Uri.parse(referer);
        String origin = page.getScheme() + "://" + page.getEncodedAuthority();
        c.setRequestProperty("Referer", origin + "/");
        c.setRequestProperty("Origin", origin);
        c.setRequestProperty("Range", "bytes=0-1023");
        int code = c.getResponseCode();
        if (code != 200 && code != 206) return "HTTP " + code;
        try (java.io.InputStream in = c.getInputStream()) {
          return "HTTP " + code + (in.read() >= 0 ? " · recibe datos" : " · respuesta vacía");
        }
      } finally { c.disconnect(); }
    } catch (Exception failure) { return ConnectionReport.describe(failure); }
  }

  private void chooseDiagnostic() {
    List<String> addresses = new ArrayList<>(channelPages);
    if (pageUrl != null && !addresses.contains(pageUrl)) addresses.add(pageUrl);
    if (directUrl != null) addresses.add(directUrl);
    if (zicoPage()) addresses.add(VideoResolver.eventApi(pageUrl) != null
        ? Library.PLAYER_ENDPOINT + "?event=" + Uri.encode(pageUrl) : HostingPlayback.request(pageUrl));
    if (addresses.isEmpty()) return;
    String[] labels = new String[addresses.size()];
    for (int i = 0; i < labels.length; i++) {
      Uri u = Uri.parse(addresses.get(i));
      labels[i] = u.getHost() + (VideoResolver.renewablePage(addresses.get(i)) || VideoResolver.eventApi(addresses.get(i)) != null ? u.getPath() : " · enlace directo");
    }
    new AlertDialog.Builder(this).setTitle("Comprobar conexión")
        .setItems(labels, (dialog, index) -> diagnoseAddress(addresses.get(index)))
        .setNegativeButton("Cerrar", null).show();
  }

  /** A source as viewers see it: its own name, or the channel's with its number; never a site's address. */
  static String viewerName(String name) {
    if (name == null || name.trim().isEmpty()
        || name.matches("(?is).*(zico|calamar|https?:|\\.(cc|com|net|org|tv|top|xyz|sbs|me|io)\\b).*")) return null;
    return name.trim();
  }

  private String sourceName(String name, int number) {
    String own = viewerName(name);
    if (own != null && !own.matches("(?i)(cdn|por el hosting|vídeo directo).*")) return own;
    return (title == null || title.trim().isEmpty() ? "Fuente " : title.trim() + " · Fuente ") + number;
  }

  private void chooseSource() {
    if (sourceDialog != null && sourceDialog.isShowing()) return;
    final boolean restoreFullscreen = fullscreen;
    // Give the modal its own normal input window rather than competing with the video surface.
    if (restoreFullscreen) applySystemBars(false);
    List<String> names = new ArrayList<>();
    List<Runnable> actions = new ArrayList<>();
    // Catalog links remain selectable before the remote page responds.
    List<String> pages = new ArrayList<>(channelPages);
    if (pageUrl != null && !pages.contains(pageUrl)) pages.add(pageUrl);
    int number = 0, checked = -1;
    // The direct IPTV links (M3U8…) first, then the player pages (ZicoTV's last, as AppSources orders them).
    for (String address : directUrls) {
      if (address.equals(currentUrl) || (currentUrl.isEmpty() && address.equals(directUrl))) checked = names.size();
      names.add(HostingPlayback.label(title, "Canal") + (directUrls.size() + pages.size() > 1 ? " · Señal " + (++number) : ""));
      actions.add(() -> selectChannelAddress(address, false));
    }
    for (String address : pages) {
      if (AppSources.zico(address) && address.equals(pageUrl)) continue;
      if (directUrl == null && !hostingPlayback && address.equals(pageUrl)) checked = names.size();
      names.add(HostingPlayback.label(eventSourceNames.get(address), HostingPlayback.label(title, "Canal") + " · Señal " + (++number)));
      actions.add(() -> selectChannelAddress(address, true));
    }
    if (zicoPage()) {
      for (HostingPlayback.Option option : hostingOptions) {
        if (hostingPlayback && option.id.equals(hostingSourceId)) checked = names.size();
        names.add(option.name);
        actions.add(() -> {
          generation++; resolving = false;
          handler.removeCallbacks(renewal); handler.removeCallbacks(renewalRequest);
          hostingPlayback = true; hostingTriedPage = pageUrl; hostingSourceId = option.id; automaticAttempts = 0;
          releasePlayer(); clearWeb(); webMode = false; resolveFresh();
        });
      }
      if (hostingOptions.isEmpty()) {
        if (hostingPlayback) checked = names.size();
        names.add(HostingPlayback.label(title, "Canal") + " · Automática");
        actions.add(() -> {
          hostingSourceId = HostingPlayback.AUTOMATIC;
          automaticAttempts = 0;
          if (!resolving) resolveFresh();
        });
      }
    }
    if (directUrl == null) {
      for (int i = 0; i < sources.size(); i++) {
        final VideoResolver.Source source = sources.get(i);
        if (HostingPlayback.isRelay(source.url) && zicoPage()) continue;
        final int selected = i;
        if (source.url.equals(currentUrl)) checked = names.size();
        names.add(HostingPlayback.label(source.label, HostingPlayback.label(title, "Canal") + " · Señal " + (i + 1)));
        actions.add(() -> {
          generation++; resolving = false;
          hostingPlayback = false;
          handler.removeCallbacks(renewal); handler.removeCallbacks(renewalRequest);
          selection = selected; automaticAttempts = 0; playSource(source);
        });
      }
    }
    if (names.isEmpty()) {
      names.add("Volver a buscar fuentes");
      actions.add(() -> { if (!resolving) resolveFresh(); });
    }
    AlertDialog.Builder picker = new AlertDialog.Builder(this)
        .setTitle("Fuentes de vídeo")
        // Open after this modal has dismissed and restored its fullscreen state.
        .setPositiveButton("DNS", (dialog, which) -> handler.post(this::chooseDns))
        .setSingleChoiceItems(names.toArray(new String[0]), checked, (dialog, index) -> {
          actions.get(index).run(); dialog.dismiss();
        })
        .setNegativeButton("Cerrar", null);
    if (SharedCatalog.administrator(com.google.firebase.auth.FirebaseAuth.getInstance(SharedCatalog.app(this)).getCurrentUser()))
      picker.setNeutralButton("Diagnóstico", (dialog, which) -> chooseDiagnostic());
    sourceDialog = picker.create();
    sourceDialog.setOnDismissListener(dialog -> {
      sourceDialog = null;
      if (active) {
        if (restoreFullscreen) applySystemBars(true);
        playerView.showController();
        keepControlsVisible(player == null || player.getPlaybackState() != Player.STATE_READY);
      }
    });
    sourceDialog.show();
    if (isTelevision()) {
      sourceDialog.getListView().requestFocus();
      if (checked >= 0) sourceDialog.getListView().setSelection(checked);
    }
  }

  private void selectChannelAddress(String address, boolean page) {
    generation++; resolving = false; webMode = false;
    handler.removeCallbacks(renewal); handler.removeCallbacks(renewalRequest);
    automaticAttempts = 0; selection = 0;
    hostingPlayback = false; hostingTriedPage = null; hostingOptions.clear(); hostingSourceId = "";
    keepControlsVisible(true);
    clearWeb(); releasePlayer(); sources.clear();
    if (page) {
      directUrl = null; pageUrl = address; documentUrl = address; directTried = false;
      pageIndex = channelPages.indexOf(address);
    } else {
      directUrl = address; pageUrl = null; documentUrl = address;
      selection = Math.max(0, directUrls.indexOf(address)); directTried = true;
    }
    resolveFresh();
  }

  private void openWeb() {
    if (!active) return;
    setFullscreen(false); // The web page has no controller, so the panel must be there.
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
            return !url.startsWith("https://") || AppSources.webOnly(url);
          }

          @Override
          public WebResourceResponse shouldInterceptRequest(
              WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (AppSources.webOnly(url)) return new WebResourceResponse("text/plain", "UTF-8",
                new java.io.ByteArrayInputStream(new byte[0]));
            if (!zicoPage() && "GET".equals(request.getMethod()) && VideoResolver.isMedia(url)) {
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
                    if (generation == browserGeneration && !zicoPage()) detected(candidate);
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

  /** Keep HLS inside Chromium. Do not detect it and send it back to the failed native engine. */
  private void openDirectWeb() {
    if (!active || directUrls.isEmpty()) return;
    String address = directUrls.get(selection);
    if (!BrowserPlayback.supports(address)) {
      problem(
          "El modo web admite enlaces HLS (.m3u8) por HTTPS. Usa Modo nativo para esta fuente.");
      return;
    }
    generation++;
    resolving = false;
    diagnosing = false;
    handler.removeCallbacks(renewal);
    handler.removeCallbacks(renewalRequest);
    releasePlayer();
    clearWeb();
    webMode = true;
    playerView.setVisibility(View.GONE);
    browser = new WebView(this);
    browser.getSettings().setJavaScriptEnabled(true);
    browser.getSettings().setDomStorageEnabled(true);
    browser.getSettings().setMediaPlaybackRequiresUserGesture(false);
    browser.getSettings().setAllowFileAccess(false);
    browser.getSettings().setAllowContentAccess(false);
    final int request = generation;
    browser.setWebViewClient(
        new WebViewClient() {
          @Override
          public boolean shouldOverrideUrlLoading(WebView view, String url) {
            // This player has no navigation; media requests use the browser's normal network stack.
            return true;
          }

          @Override
          public void onPageFinished(WebView view, String url) {
            if (active && webMode && generation == request && browser == view)
              status.setText(
                  "Reproductor web · Si no empieza, pulsa Reproducir. Atrás sale de pantalla"
                      + " completa.");
          }

          @Override
          public void onReceivedError(
              WebView view,
              android.webkit.WebResourceRequest resource,
              android.webkit.WebResourceError error) {
            if (resource.isForMainFrame() && active && generation == request && browser == view)
              problem(
                  "No se pudo cargar el reproductor web. Comprueba la conexión y vuelve a abrir el canal.");
          }
        });
    stage.addView(browser, new FrameLayout.LayoutParams(-1, -1));
    status.setText("Abriendo el reproductor web integrado…");
    browser.loadUrl(BrowserPlayback.page(address));
    browser.requestFocus();
  }

  private void detected(String address) {
    if (!active || !webMode || !VideoResolver.isMedia(address) || AppSources.webOnly(address)) return;
    VideoResolver.Source source = new VideoResolver.Source("Vídeo detectado", address);
    sources.clear();
    sources.add(source);
    updateSourceButton();
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

  /** Saves where the film or episode is, so it can continue there (also after a retry or a pause). */
  private void rememberPosition() {
    if (progressEntry == null || player == null || ended) return;
    long position = player.getCurrentPosition(), duration = player.getDuration();
    if (position <= 0) return;
    resumeMs = position;
    Library.Progress.save(this, Library.Progress.record(Library.Progress.load(this), progressEntry, position,
        duration == androidx.media3.common.C.TIME_UNSET ? 0 : duration, System.currentTimeMillis()));
  }

  private void releasePlayer() {
    rememberPosition();
    cancelBufferingTimeout();
    if (player != null) {
      playerView.setPlayer(null);
      player.release();
      player = null;
    }
    currentUrl = "";
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (isTelevision() && active
        && playerView != null && (sourceDialog == null || !sourceDialog.isShowing())) {
      if (event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_MENU) { chooseSource(); return true; }
      if (event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_DPAD_UP) {
        playerView.showController(); panel.setVisibility(View.VISIBLE);
        sourceButton.requestFocus(); panel.post(() -> { if (active && panel.getVisibility() == View.VISIBLE) sourceButton.requestFocus(); });
        return true;
      }
      // Let the remote activate the focused header button instead of sending its Enter to the video.
      if (panel.hasFocus()) return super.dispatchKeyEvent(event);
    }
    return playerView != null
            && playerView.getVisibility() == View.VISIBLE
            && playerView.dispatchKeyEvent(event)
        || super.dispatchKeyEvent(event);
  }

  @Override
  protected void onStop() {
    active = false;
    if (sourceDialog != null) { sourceDialog.dismiss(); sourceDialog = null; }
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
    handler.removeCallbacks(skipTick);
    if (castControls != null) castControls.destroy();
    worker.shutdownNow();
    sourceMenuWorker.shutdownNow();
    super.onDestroy();
  }

  /** Watched to the end (or «Siguiente capítulo»): out of «Continuar viendo», and the series plays the next one. */
  private void endEpisode() {
    if (ended || progressEntry == null) return;
    ended = true;
    handler.removeCallbacks(skipTick);
    Library.Progress.save(this, Library.Progress.remove(Library.Progress.load(this), progressEntry.optString("key")));
    setResult(RESULT_OK, new Intent().putExtra("ended", progressEntry.optString("key")));
    finish();
  }

  private void addSkipButtons() {
    skipMarks = new int[] {progressEntry.optInt("intro_start", -1), progressEntry.optInt("intro_end", -1), progressEntry.optInt("credits", Library.CREDITS_DEFAULT), -1, 0};
    hasNext = progressEntry.optBoolean("has_next");
    askIntroDb();
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    skipIntroButton = Ui.pill(this, "Saltar intro", Ui.Kind.SURFACE, false);
    skipIntroButton.setOnClickListener(v -> {
      if (player != null && skipMarks[0] >= 0) player.seekTo(skipMarks[1] * 1000L);
      paintSkip();
    });
    nextButton = Ui.pill(this, "Siguiente capítulo", Ui.Kind.ACCENT, false);
    nextButton.setOnClickListener(v -> endEpisode());
    nextDismissButton = Ui.pill(this, "✕", Ui.Kind.SURFACE, true);
    nextDismissButton.setContentDescription("Seguir viendo los créditos");
    nextDismissButton.setOnClickListener(v -> { nextDismissed = true; paintSkip(); });
    LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(-2, -2);
    gap.setMargins(Ui.dp(this, 8), 0, 0, 0);
    row.addView(skipIntroButton, new LinearLayout.LayoutParams(-2, -2));
    row.addView(nextButton, new LinearLayout.LayoutParams(-2, -2));
    row.addView(nextDismissButton, gap);
    FrameLayout.LayoutParams place = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.END);
    place.setMargins(0, 0, Ui.dp(this, 24), Ui.dp(this, 96));
    stage.addView(row, place);
    paintSkip();
    handler.post(skipTick);
  }

  private void paintSkip() {
    if (skipIntroButton == null) return;
    long t = player == null ? -1 : player.getCurrentPosition(), duration = player == null ? -1 : player.getDuration();
    if (duration == androidx.media3.common.C.TIME_UNSET) duration = -1;
    int shown = player == null || webMode ? 0 : Library.skipButton(skipMarks, t, duration, hasNext);
    show(skipIntroButton, shown == 1);
    boolean next = shown == 2 && !nextDismissed;
    show(nextButton, next);
    show(nextDismissButton, next);
    if (!next || !player.isPlaying()) { nextCountAt = -1; if (next) nextButton.setText("Siguiente capítulo"); return; }
    long now = android.os.SystemClock.elapsedRealtime();
    if (nextCountAt < 0) nextCountAt = now;
    long left = Math.max(0, NEXT_COUNT - (now - nextCountAt) / 1000);
    nextButton.setText("Siguiente capítulo · " + left);
    if (left == 0) endEpisode();
  }

  /** This episode's intro and credits from TheIntroDB, where none were typed in the admin page. */
  private void askIntroDb() {
    final boolean manualIntro = progressEntry.optBoolean("manual_intro"), manualCredits = progressEntry.optBoolean("manual_credits");
    final int tmdb = progressEntry.optInt("tmdb", 0);
    if (tmdb <= 0 || (manualIntro && manualCredits)) return;
    final String address = Library.INTRODB_API + "?tmdb_id=" + tmdb + "&season=" + progressEntry.optInt("season", 1)
        + "&episode=" + progressEntry.optInt("episode_number", 0);
    worker.execute(() -> {
      try {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(address).openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(8000);
        c.setRequestProperty("User-Agent", "CalamarTV/" + BuildConfig.VERSION_NAME + " (Android)");
        if (c.getResponseCode() != 200) return;
        String body;
        try (java.io.InputStream in = c.getInputStream()) {
          java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
          byte[] buffer = new byte[4096];
          for (int n; (n = in.read(buffer)) != -1 && out.size() < 65536; ) out.write(buffer, 0, n);
          body = out.toString("UTF-8");
        }
        final int[] found = Library.introDbMarks(new org.json.JSONObject(body));
        handler.post(() -> {
          if (skipMarks == null || isFinishing()) return;
          if (!manualIntro && found[0] >= 0) { skipMarks[0] = found[0]; skipMarks[1] = found[1]; }
          if (!manualCredits) skipMarks[3] = found[2];
          paintSkip();
        });
      } catch (Exception ignored) {
        // Without TheIntroDB the typed times (or the last 30 seconds) are used.
      }
    });
  }

  /** Shows or hides a skip button; on a TV the button that appears takes the focus, so OK presses it. */
  private void show(Button button, boolean visible) {
    boolean was = button.getVisibility() == View.VISIBLE;
    button.setVisibility(visible ? View.VISIBLE : View.GONE);
    if (visible && !was && isTelevision() && button != nextDismissButton) button.requestFocus();
  }
}
