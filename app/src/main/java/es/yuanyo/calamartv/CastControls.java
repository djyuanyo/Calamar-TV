package es.yuanyo.calamartv;

import android.graphics.Color;
import android.view.View;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.Toast;
import androidx.fragment.app.FragmentActivity;
import androidx.mediarouter.app.MediaRouteButton;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.framework.CastButtonFactory;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;

/** Native discovery and TV controls; ordinary local playback survives absent Play services. */
public final class CastControls {
  public interface SourceProvider { String current(); }
  /** Where a film or episode is playing here, in ms; -1 for live channels. */
  public interface Position { long ms(); }
  private final FragmentActivity activity;
  private final SourceProvider source;
  private final String title;
  private final Runnable sent;
  private final Position position;
  private SessionManager sessions;
  private LinearLayout control;
  private String lastSent;
  private MediaRouteButton route;
  private boolean destroyed;
  private boolean preparing;
  private final CastAdapter adapter = new CastAdapter();
  private final java.util.concurrent.ExecutorService worker = java.util.concurrent.Executors.newSingleThreadExecutor();

  public CastControls(FragmentActivity activity, LinearLayout row, SourceProvider source,
      String title, Runnable sent) {
    this(activity, row, source, title, sent, () -> -1);
  }

  public CastControls(FragmentActivity activity, LinearLayout row, SourceProvider source,
      String title, Runnable sent, Position position) {
    this.activity = activity; this.source = source; this.title = title; this.sent = sent; this.position = position;
    try {
      sessions = CastContext.getSharedInstance(activity).getSessionManager();
      route = new MediaRouteButton(activity) {
        @Override public boolean performClick() {
          if (!connected() && !castable(source.current())) {
            message("Esta fuente no contiene un enlace de vídeo compatible para enviar a Chromecast.");
            return true;
          }
          if (connected() && !java.util.Objects.equals(lastSent, source.current())) send();
          return super.performClick();
        }
      };
      route.setContentDescription("Compartir pantalla");
      route.setFocusable(false);
      route.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
      route.setBackgroundColor(Color.TRANSPARENT);
      // Icon only, the same size as the full screen button; the name stays for screen readers.
      control = new LinearLayout(activity);
      control.setGravity(Gravity.CENTER);
      control.setBackground(Ui.focusFill(activity, Ui.SURFACE, 0xff30352a, Ui.ACC, 999, 0));
      control.setFocusable(true);
      control.setContentDescription("Compartir pantalla");
      control.setOnClickListener(v -> route.performClick());
      if (android.os.Build.VERSION.SDK_INT >= 26) control.setTooltipText("Compartir pantalla");
      control.addView(route, new LinearLayout.LayoutParams(Ui.dp(activity, 24), Ui.dp(activity, 40)));
      LinearLayout.LayoutParams size = new LinearLayout.LayoutParams(Ui.dp(activity, 44), Ui.dp(activity, 40));
      size.setMargins(Ui.dp(activity, 4), Ui.dp(activity, 4), Ui.dp(activity, 4), Ui.dp(activity, 4));
      row.addView(control, size);
      CastButtonFactory.setUpMediaRouteButton(activity, route);
      sessions.addSessionManagerListener(listener, CastSession.class);
      update();
    } catch (RuntimeException unavailable) {
      sessions = null; // Some Android TV devices do not include Google Play services.
      if (route != null) route.setVisibility(View.GONE);
      if (control != null) control.setVisibility(View.GONE);
    }
  }

  private void update() {
    if (control != null) control.setActivated(connected());
  }

  public boolean connected() {
    CastSession session = sessions == null ? null : sessions.getCurrentCastSession();
    return session != null && session.isConnected();
  }

  private RemoteMediaClient remote() {
    return connected() ? sessions.getCurrentCastSession().getRemoteMediaClient() : null;
  }

  private void message(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }

  private static boolean castable(String address) {
    return CastSource.contentType(address) != null || CastSource.castBridge(address) || CastSource.list(address);
  }

  public void send() {
    if (destroyed || preparing) return;
    String address = source.current();
    if (!castable(address)) {
      message("Esta fuente no contiene un enlace de vídeo compatible para enviar a Chromecast.");
      return;
    }
    long at = position.ms();
    String type = CastSource.contentType(address);
    // An HTTP list cannot load on the receiver's HTTPS page: the hosting hands it out over HTTPS.
    if (type != null && !(CastSource.list(address) && address.regionMatches(true, 0, "http://", 0, 7))) {
      load(address, type, address, at, CastSource.list(address));
      return;
    }
    prepare(address, at);
  }

  /** Through the hosting: the converted TS channel, or the relayed list of an M3U8 channel. */
  private void prepare(String address, long at) {
    preparing = true;
    message("Preparando el canal para la TV…");
    worker.execute(() -> {
      try {
        String url = CastSource.list(address)
            ? HostingPlayback.resolve(address, NetworkTransport.get(DnsProvider.SYSTEM)) : adapter.prepare(address);
        activity.runOnUiThread(() -> {
          preparing = false;
          if (!destroyed && address.equals(source.current())) load(url, "application/x-mpegURL", address, at, false);
        });
      } catch (Exception failure) {
        activity.runOnUiThread(() -> {
          preparing = false;
          if (!destroyed) message(failure instanceof java.io.IOException
              && failure.getMessage() != null && !failure.getMessage().contains("http")
              ? failure.getMessage() : "No se pudo preparar el vídeo en el hosting.");
        });
      }
    });
  }

  /** at: the minute of a film or episode (it goes on there on the TV); -1 for live channels. */
  private void load(String address, String type, String original, long at, boolean retryRelayed) {
    RemoteMediaClient remote = remote();
    if (remote == null) return;
    MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_GENERIC);
    metadata.putString(MediaMetadata.KEY_TITLE, title == null ? "Calamar TV" : title);
    boolean live = at < 0 && CastSource.live(type) && !CastSource.onDemand(address);
    MediaInfo media = new MediaInfo.Builder(address).setContentType(type)
        .setStreamType(live ? MediaInfo.STREAM_TYPE_LIVE : MediaInfo.STREAM_TYPE_BUFFERED)
        .setMetadata(metadata).build();
    MediaLoadRequestData.Builder request = new MediaLoadRequestData.Builder().setMediaInfo(media).setAutoplay(true);
    if (at > 0) request.setCurrentTime(at);
    remote.load(request.build())
        .setResultCallback(result -> {
          if (destroyed) return;
          if (result.getStatus().isSuccess()) {
            lastSent = original;
            if (original.equals(source.current())) sent.run();
            message("Reproduciendo en Chromecast. Pulsa Compartir pantalla para pausar o desconectar.");
          } else if (retryRelayed && original.equals(source.current())) {
            // The list's server does not let the TV read it (no CORS): once more, through the hosting.
            prepare(original, at);
          } else message("Chromecast no pudo cargar esta fuente. Comprueba el formato y el acceso del televisor al enlace.");
        });
  }

  private final SessionManagerListener<CastSession> listener = new SessionManagerListener<CastSession>() {
    @Override public void onSessionStarting(CastSession session) {}
    @Override public void onSessionStarted(CastSession session, String id) { update(); send(); }
    @Override public void onSessionStartFailed(CastSession session, int error) { update(); message("No se pudo conectar con Chromecast."); }
    @Override public void onSessionEnding(CastSession session) {}
    @Override public void onSessionEnded(CastSession session, int error) { update(); message("Chromecast desconectado. Pulsa Refrescar para seguir en el dispositivo."); }
    @Override public void onSessionResuming(CastSession session, String id) {}
    @Override public void onSessionResumed(CastSession session, boolean suspended) { update(); }
    @Override public void onSessionResumeFailed(CastSession session, int error) { update(); }
    @Override public void onSessionSuspended(CastSession session, int reason) { update(); }
  };

  /** Expiry or a released playback reservation also stops the receiver, not only the local picture. */
  public void stopForAccess() {
    adapter.cancel();lastSent=null;
    if(sessions!=null)try{sessions.endCurrentSession(true);}catch(RuntimeException ignored){}
  }
  public void destroy() {
    destroyed = true;
    adapter.cancel();
    worker.shutdownNow();
    if (sessions != null) sessions.removeSessionManagerListener(listener, CastSession.class);
  }
}
