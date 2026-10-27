package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isChecked;
import static androidx.test.espresso.matcher.RootMatchers.isDialog;
import android.content.Intent;
import android.os.SystemClock;
import android.view.View;
import android.widget.Button;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.net.InetAddress;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;
import okio.Buffer;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Local TLS player document -> extracted HLS -> actual native video, including expired-source recovery. */
@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class ResolvedPlaybackTest {
  @Test public void extractedHttpsHlsActuallyPlaysAndShowsSources() throws Exception { playback(false, false); }
  @Test public void rejectedTokenReadsFreshPageAndRecoversNatively() throws Exception { playback(true, false); }

  @Test public void sourcePickerOffersCatalogAlternativeWhilePageIsStalled() throws Exception { playback(false, true); }

  @Test public void zicoEventApiResolvesAndActuallyPlays() throws Exception { playback(false, false, true); }
  private void playback(boolean rejectFirst, boolean manualDirect) throws Exception { playback(rejectFirst, manualDirect, false); }
  private void playback(boolean rejectFirst, boolean manualDirect, boolean eventPage) throws Exception {
    HeldCertificate certificate = new HeldCertificate.Builder().commonName("bp.zicotv.cc")
        .addSubjectAlternativeName("bp.zicotv.cc").build();
    HandshakeCertificates serverTls = new HandshakeCertificates.Builder().heldCertificate(certificate).build();
    HandshakeCertificates clientTls = new HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate()).build();
    Buffer video = new Buffer();
    try (InputStream in = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        .getContext().getAssets().open("live.ts")) {
      byte[] block = new byte[8192];
      for (int count; (count = in.read(block)) != -1;) video.write(block, 0, count);
    }
    AtomicInteger pages = new AtomicInteger();
    java.util.concurrent.CountDownLatch releasePage = new java.util.concurrent.CountDownLatch(1);
    AtomicBoolean matchingProfile = new AtomicBoolean(true);
    try (MockWebServer server = new MockWebServer()) {
      server.useHttps(serverTls.sslSocketFactory(), false);
      server.start();
      String origin = server.url("/").newBuilder().host("bp.zicotv.cc").build().toString();
      server.setDispatcher(new Dispatcher() {
        @Override public MockResponse dispatch(RecordedRequest request) {
          String path = request.getPath();
          if (!manualDirect && !PlayerDocument.BROWSER_USER_AGENT.equals(request.getHeader("User-Agent"))) matchingProfile.set(false);
          if (path.startsWith("/api/v1/events/98019")) return new MockResponse().setHeader("Content-Type", "application/json")
              .setBody("{\"data\":{\"sources\":[{\"name\":\"Canal del evento\",\"player_url\":\"" + origin + "api/player/28\"}]}}");
          if (path.startsWith("/api/player/28")) {
            int n = pages.incrementAndGet();
            if (manualDirect) {
              try { releasePage.await(20, java.util.concurrent.TimeUnit.SECONDS); }
              catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
              return new MockResponse().setResponseCode(503);
            }
            return new MockResponse().setHeader("Content-Type", "text/html").setBody(
                "var ZT_SOURCES=[{\"label\":\"CDN prueba\",\"url\":\"" + origin + "live.m3u8?token=" + n + "\"}];");
          }
          if (path.startsWith("/live.m3u8")) {
            if (rejectFirst && path.contains("token=1")) return new MockResponse().setResponseCode(403);
            return new MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl")
                .setBody("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:20\n#EXTINF:20,\nsegment.ts\n#EXT-X-ENDLIST\n");
          }
          if (path.startsWith("/segment.ts")) return new MockResponse().setHeader("Content-Type", "video/mp2t").setBody(video.clone());
          return new MockResponse().setResponseCode(404);
        }
      });
      NetworkTransport network = NetworkTransport.get(DnsProvider.SYSTEM);
      Field clientField = NetworkTransport.class.getDeclaredField("client"); clientField.setAccessible(true);
      OkHttpClient original = (OkHttpClient) clientField.get(network);
      DnsProvider previous = NetworkTransport.selected(ApplicationProvider.getApplicationContext());
      OkHttpClient local = new OkHttpClient.Builder().sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager())
          .dns(host -> Collections.singletonList(InetAddress.getByName("127.0.0.1"))).build();
      clientField.set(network, local);
      NetworkTransport.select(ApplicationProvider.getApplicationContext(), DnsProvider.SYSTEM);
      Intent intent = new Intent(ApplicationProvider.getApplicationContext(), NativePlayerActivity.class)
          .putExtra("page_url", origin + (eventPage ? "events/98019" : "api/player/28")).putExtra("title", "Prueba de canal resuelto");
      if (manualDirect) intent.putStringArrayListExtra("channel_streams", new java.util.ArrayList<>(
          java.util.Arrays.asList(origin + "api/player/28", origin + "live.m3u8?token=direct")));
      try (ActivityScenario<NativePlayerActivity> scenario = ActivityScenario.launch(intent)) {
        if (manualDirect) {
          long lookupDeadline = SystemClock.elapsedRealtime() + 10000;
          while (pages.get() == 0 && SystemClock.elapsedRealtime() < lookupDeadline) SystemClock.sleep(100);
          AtomicBoolean controlsVisible = new AtomicBoolean();
          long controlsDeadline = SystemClock.elapsedRealtime() + 3000;
          while (!controlsVisible.get() && SystemClock.elapsedRealtime() < controlsDeadline) {
            scenario.onActivity(activity -> {
              try {
                Field view = NativePlayerActivity.class.getDeclaredField("playerView"); view.setAccessible(true);
                androidx.media3.ui.PlayerView playerView = (androidx.media3.ui.PlayerView) view.get(activity);
                controlsVisible.set(playerView.getControllerShowTimeoutMs() == 0 && playerView.isControllerFullyVisible());
              } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
            });
            SystemClock.sleep(50);
          }
          assertTrue("Loading/error controls must stay visible without a video", controlsVisible.get());
          scenario.onActivity(activity -> {
            try {
              Field button = NativePlayerActivity.class.getDeclaredField("sourceButton"); button.setAccessible(true);
              ((Button) button.get(activity)).performClick();
            } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
          });
          onView(withText("Enlace 1 · bp.zicotv.cc")).inRoot(isDialog()).check(matches(isChecked()));
          onView(withText("Enlace 2 · Vídeo directo")).inRoot(isDialog()).perform(click());
        }
        AtomicBoolean playing = new AtomicBoolean();
        long deadline = SystemClock.elapsedRealtime() + 30000;
        while (!playing.get() && SystemClock.elapsedRealtime() < deadline) {
          scenario.onActivity(activity -> {
            try {
              Field playerField = NativePlayerActivity.class.getDeclaredField("player"); playerField.setAccessible(true);
              ExoPlayer player = (ExoPlayer) playerField.get(activity);
              playing.set(player != null && player.isPlaying() && player.getVideoSize().width > 0 && player.getCurrentPosition() > 300);
            } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
          });
          SystemClock.sleep(100);
        }
        assertTrue("The resolved HTTPS video never played in ExoPlayer", playing.get());
        assertTrue(pages.get() >= (rejectFirst ? 2 : 1));
        assertTrue("Page and extracted HLS must use the same browser profile", matchingProfile.get());
        scenario.onActivity(activity -> {
          try {
            Field buttonField = NativePlayerActivity.class.getDeclaredField("sourceButton"); buttonField.setAccessible(true);
            assertEquals(View.VISIBLE, ((Button) buttonField.get(activity)).getVisibility());
            Field browserField = NativePlayerActivity.class.getDeclaredField("browser"); browserField.setAccessible(true);
            assertNull("A resolved channel must stay in our native player", browserField.get(activity));
          } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
        });
        scenario.onActivity(activity -> {
          try {
            Field button = NativePlayerActivity.class.getDeclaredField("sourceButton"); button.setAccessible(true);
            ((Button) button.get(activity)).performClick();
          } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
        });
        onView(withText(manualDirect ? "Enlace 2 · Vídeo directo" : "CDN · CDN prueba")).inRoot(isDialog()).check(matches(isChecked()));
        onView(withText("Cerrar")).inRoot(isDialog()).perform(click());
      } finally {
        releasePage.countDown();
        clientField.set(network, original);
        NetworkTransport.select(ApplicationProvider.getApplicationContext(), previous);
      }
    }
  }
}
