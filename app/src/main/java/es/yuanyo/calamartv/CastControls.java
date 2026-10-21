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
  private final FragmentActivity activity;
  private final SourceProvider source;
  private final String title;
  private final Runnable sent;
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
    this.activity = activity; this.source = source; this.title = title; this.sent = sent;
    try {
      sessions = CastContext.getSharedInstance(activity).getSessionManager();
      route = new MediaRouteButton(activity) {
        @Override public boolean performClick() {
          if (!connected() && CastSource.contentType(source.current()) == null && !CastSource.needsBridge(source.current())) {
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

  public void send() {
    if (destroyed || preparing) return;
    String address = source.current();
    String type = CastSource.contentType(address);
    if (type == null) {
      if (!CastSource.needsBridge(address)) {
        message("Esta fuente no contiene un enlace de vídeo compatible para enviar a Chromecast.");
        return;
      }
      preparing = true;
      message("Preparando el canal para la TV…");
      worker.execute(() -> {
        try {
          String url = adapter.prepare(address);
          activity.runOnUiThread(() -> {
            preparing = false;
            if (!destroyed && address.equals(source.current())) load(url, "application/x-mpegURL", address);
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
      return;
    }
    load(address, type, address);
  }

  private void load(String address, String type, String original) {
    RemoteMediaClient remote = remote();
    if (remote == null) return;
    MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_GENERIC);
    metadata.putString(MediaMetadata.KEY_TITLE, title == null ? "Calamar TV" : title);
    MediaInfo media = new MediaInfo.Builder(address).setContentType(type)
        .setStreamType(CastSource.live(type) ? MediaInfo.STREAM_TYPE_LIVE : MediaInfo.STREAM_TYPE_BUFFERED)
        .setMetadata(metadata).build();
    remote.load(new MediaLoadRequestData.Builder().setMediaInfo(media).setAutoplay(true).build())
        .setResultCallback(result -> {
          if (destroyed) return;
          if (result.getStatus().isSuccess()) {
            lastSent = original;
            if (original.equals(source.current())) sent.run();
            message("Reproduciendo en Chromecast. Pulsa Compartir pantalla para pausar o desconectar.");
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

  public void destroy() {
    destroyed = true;
    adapter.cancel();
    worker.shutdownNow();
    if (sessions != null) sessions.removeSessionManagerListener(listener, CastSession.class);
  }
}
