package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import android.content.Intent;
import android.os.SystemClock;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.io.InputStream;
import java.io.IOException;
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

/** A public IPTV connection fails on the device; the HTTPS hosting must render actual video. */
@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class IptvHostedPlaybackTest {
  @Test public void blockedHttpIptvPlaysThroughHostingOnPhoneAndTv() throws Exception {
    String source = "http://iptv.example:8080/user/password/256";
    HeldCertificate cert = new HeldCertificate.Builder().commonName("calamarmenciano.com")
        .addSubjectAlternativeName("calamarmenciano.com").build();
    HandshakeCertificates serverTls = new HandshakeCertificates.Builder().heldCertificate(cert).build();
    HandshakeCertificates tls = new HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate()).build();
    Buffer video = new Buffer();
    try (InputStream in = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("live.ts")) {
      byte[] block = new byte[8192]; for (int n; (n = in.read(block)) != -1;) video.write(block, 0, n);
    }
    AtomicInteger direct = new AtomicInteger(), hosted = new AtomicInteger();
    AtomicBoolean headersValid = new AtomicBoolean(true);
    try (MockWebServer server = new MockWebServer()) {
      server.useHttps(serverTls.sslSocketFactory(), false); server.start();
      server.setDispatcher(new Dispatcher() {
        @Override public MockResponse dispatch(RecordedRequest r) {
          if (!"/calamar-tv-relay.php?stream=1".equals(r.getPath())) return new MockResponse().setResponseCode(404);
          hosted.incrementAndGet();
          String encoded = android.util.Base64.encodeToString(source.getBytes(java.nio.charset.StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
          if (!encoded.equals(r.getHeader("X-Calamar-Source")) || r.getHeader("Range") != null
              || !PlayerDocument.IPTV_USER_AGENT.equals(r.getHeader("User-Agent"))) headersValid.set(false);
          return new MockResponse().setHeader("Content-Type", "video/mp2t").setBody(video.clone());
        }
      });
      NetworkTransport system = NetworkTransport.get(DnsProvider.SYSTEM), secure = NetworkTransport.get(DnsProvider.GOOGLE);
      Field client = NetworkTransport.class.getDeclaredField("client"); client.setAccessible(true);
      OkHttpClient oldSystem = (OkHttpClient)client.get(system), oldSecure = (OkHttpClient)client.get(secure);
      DnsProvider previous = NetworkTransport.selected(ApplicationProvider.getApplicationContext());
      client.set(secure, new OkHttpClient.Builder().addInterceptor(chain -> {
        direct.incrementAndGet(); throw new IOException("Device IPTV connection reset");
      }).build());
      client.set(system, new OkHttpClient.Builder().sslSocketFactory(tls.sslSocketFactory(), tls.trustManager())
          .dns(host -> Collections.singletonList(InetAddress.getByName("127.0.0.1")))
          .addInterceptor(chain -> chain.proceed(chain.request().newBuilder()
              .url(chain.request().url().newBuilder().port(server.getPort()).build()).build())).build());
      NetworkTransport.select(ApplicationProvider.getApplicationContext(), DnsProvider.GOOGLE);
      Intent intent = new Intent(ApplicationProvider.getApplicationContext(), NativePlayerActivity.class)
          .putExtra("media_url", source).putExtra("title", "Prueba IPTV por hosting");
      try (ActivityScenario<NativePlayerActivity> scenario = ActivityScenario.launch(intent)) {
        AtomicBoolean playing = new AtomicBoolean(); long until = SystemClock.elapsedRealtime() + 30000;
        while (!playing.get() && SystemClock.elapsedRealtime() < until) {
          scenario.onActivity(activity -> {
            try {
              Field player = NativePlayerActivity.class.getDeclaredField("player"); player.setAccessible(true);
              ExoPlayer p = (ExoPlayer)player.get(activity);
              playing.set(p != null && p.isPlaying() && p.getVideoSize().width > 0 && p.getCurrentPosition() > 300);
            } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
          });
          SystemClock.sleep(100);
        }
        assertTrue("Failed HTTP IPTV must render video through the HTTPS hosting", playing.get());
        assertEquals("The blocked direct source must not be retried in a loop", 1, direct.get());
        assertTrue(hosted.get() > 0); assertTrue("Relay must use only the encoded source header and no byte range", headersValid.get());
      } finally {
        client.set(system, oldSystem); client.set(secure, oldSecure);
        NetworkTransport.select(ApplicationProvider.getApplicationContext(), previous);
      }
    }
  }
}
