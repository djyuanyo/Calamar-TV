package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import android.content.Intent;
import android.os.SystemClock;
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
import okhttp3.mockwebserver.*;
import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;
import okio.Buffer;
import org.junit.Test;
import org.junit.runner.RunWith;

/** The device's player page fails; the hosting returns an HLS list and all media stays on that host. */
@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class HostingPlaybackTest {
  @Test public void blockedPageUsesHostingForVideoAndRenewsThere() throws Exception {
    HeldCertificate cert = new HeldCertificate.Builder().commonName("calamarmenciano.com")
        .addSubjectAlternativeName("calamarmenciano.com").addSubjectAlternativeName("bp.zicotv.cc").build();
    HandshakeCertificates serverTls = new HandshakeCertificates.Builder().heldCertificate(cert).build();
    HandshakeCertificates tls = new HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate()).build();
    Buffer video = new Buffer();
    try (InputStream in = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("live.ts")) {
      byte[] block = new byte[8192]; for (int n; (n = in.read(block)) != -1;) video.write(block, 0, n);
    }
    AtomicInteger pages = new AtomicInteger(), renewals = new AtomicInteger(), segments = new AtomicInteger();
    try (MockWebServer server = new MockWebServer()) {
      server.useHttps(serverTls.sslSocketFactory(), false); server.start();
      server.setDispatcher(new Dispatcher() {
        @Override public MockResponse dispatch(RecordedRequest r) {
          String path = r.getPath();
          if (path.startsWith("/api/player/4")) { pages.incrementAndGet(); return new MockResponse().setResponseCode(503); }
          if (path.startsWith("/calamar-player.php?page=")) {
            int n = renewals.incrementAndGet();
            return new MockResponse().setHeader("Content-Type", "application/json").setBody(
                "{\"url\":\"calamar-player.php?seg=manifest&sig=" + n + "&l=1\"}");
          }
          if (path.startsWith("/calamar-player.php?seg=manifest")) {
            if (path.contains("sig=1&")) return new MockResponse().setResponseCode(403);
            return new MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl").setBody(
                "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:20\n#EXTINF:20,\ncalamar-player.php?seg=video&sig=piece\n#EXT-X-ENDLIST\n");
          }
          if (path.startsWith("/calamar-player.php?seg=video")) {
            segments.incrementAndGet(); return new MockResponse().setHeader("Content-Type", "video/mp2t").setBody(video.clone());
          }
          return new MockResponse().setResponseCode(404);
        }
      });
      NetworkTransport network = NetworkTransport.get(DnsProvider.SYSTEM);
      Field f = NetworkTransport.class.getDeclaredField("client"); f.setAccessible(true);
      OkHttpClient original = (OkHttpClient) f.get(network);
      DnsProvider previous = NetworkTransport.selected(ApplicationProvider.getApplicationContext());
      OkHttpClient local = new OkHttpClient.Builder().sslSocketFactory(tls.sslSocketFactory(), tls.trustManager())
          .dns(host -> Collections.singletonList(InetAddress.getByName("127.0.0.1")))
          .addInterceptor(chain -> chain.proceed(chain.request().newBuilder()
              .url(chain.request().url().newBuilder().port(server.getPort()).build()).build())).build();
      f.set(network, local); NetworkTransport.select(ApplicationProvider.getApplicationContext(), DnsProvider.SYSTEM);
      Intent intent = new Intent(ApplicationProvider.getApplicationContext(), NativePlayerActivity.class)
          .putExtra("page_url", "https://bp.zicotv.cc/api/player/4").putExtra("title", "Prueba hosting");
      try (ActivityScenario<NativePlayerActivity> scenario = ActivityScenario.launch(intent)) {
        assertPlays(scenario);
        assertTrue("A rejected hosted token must obtain a fresh signed list", renewals.get() >= 2);
        assertTrue(segments.get() > 0);
        assertEquals(1, pages.get());
        int before = renewals.get();
        scenario.onActivity(activity -> {
          try {
            Field renewal = NativePlayerActivity.class.getDeclaredField("renewal"); renewal.setAccessible(true);
            ((Runnable) renewal.get(activity)).run();
          } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
        });
        long deadline = SystemClock.elapsedRealtime() + 15000;
        while (renewals.get() <= before && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
        assertTrue(renewals.get() > before);
        assertPlays(scenario);
        assertEquals("Renewals must not return to the failing provider page", 1, pages.get());
      } finally { f.set(network, original); NetworkTransport.select(ApplicationProvider.getApplicationContext(), previous); }
    }
  }

  private void assertPlays(ActivityScenario<NativePlayerActivity> scenario) {
    AtomicBoolean playing = new AtomicBoolean(); long deadline = SystemClock.elapsedRealtime() + 30000;
    while (!playing.get() && SystemClock.elapsedRealtime() < deadline) {
      scenario.onActivity(activity -> {
        try {
          Field f = NativePlayerActivity.class.getDeclaredField("player"); f.setAccessible(true);
          ExoPlayer p = (ExoPlayer) f.get(activity);
          playing.set(p != null && p.isPlaying() && p.getVideoSize().width > 0 && p.getCurrentPosition() > 300);
        } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
      });
      SystemClock.sleep(100);
    }
    assertTrue("Hosted HLS must render video in the native player", playing.get());
  }
}
