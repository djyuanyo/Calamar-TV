package es.yuanyo.calamartv;

import static org.junit.Assert.*;
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
  @Test public void extractedHttpsHlsActuallyPlaysAndShowsSources() throws Exception { playback(false); }
  @Test public void rejectedTokenReadsFreshPageAndRecoversNatively() throws Exception { playback(true); }

  private void playback(boolean rejectFirst) throws Exception {
    HeldCertificate certificate = new HeldCertificate.Builder().commonName("zicotv.cc")
        .addSubjectAlternativeName("zicotv.cc").build();
    HandshakeCertificates serverTls = new HandshakeCertificates.Builder().heldCertificate(certificate).build();
    HandshakeCertificates clientTls = new HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate()).build();
    Buffer video = new Buffer();
    try (InputStream in = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        .getContext().getAssets().open("live.ts")) {
      byte[] block = new byte[8192];
      for (int count; (count = in.read(block)) != -1;) video.write(block, 0, count);
    }
    AtomicInteger pages = new AtomicInteger();
    try (MockWebServer server = new MockWebServer()) {
      server.useHttps(serverTls.sslSocketFactory(), false);
      server.start();
      String origin = server.url("/").newBuilder().host("zicotv.cc").build().toString();
      server.setDispatcher(new Dispatcher() {
        @Override public MockResponse dispatch(RecordedRequest request) {
          String path = request.getPath();
          if (path.startsWith("/api/player/28")) {
            int n = pages.incrementAndGet();
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
          .putExtra("page_url", origin + "api/player/28").putExtra("title", "Prueba de canal resuelto");
      try (ActivityScenario<NativePlayerActivity> scenario = ActivityScenario.launch(intent)) {
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
        scenario.onActivity(activity -> {
          try {
            Field buttonField = NativePlayerActivity.class.getDeclaredField("sourceButton"); buttonField.setAccessible(true);
            assertEquals(View.VISIBLE, ((Button) buttonField.get(activity)).getVisibility());
            Field browserField = NativePlayerActivity.class.getDeclaredField("browser"); browserField.setAccessible(true);
            assertNull("A resolved channel must stay in our native player", browserField.get(activity));
          } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
        });
      } finally {
        clientField.set(network, original);
        NetworkTransport.select(ApplicationProvider.getApplicationContext(), previous);
      }
    }
  }
}
