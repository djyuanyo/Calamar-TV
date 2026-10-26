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
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okio.Buffer;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class ChromiumPlaybackTest {
  @Test public void chromiumDocumentConnectionActuallyReceivesResponse() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(new MockResponse().setBody("public player document")); server.start();
      HttpURLConnection connection = ChromiumNetwork.get(ApplicationProvider.getApplicationContext()).open(server.url("/player").url());
      connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
      connection.setInstanceFollowRedirects(false);
      try {
        assertEquals(200, connection.getResponseCode()); assertEquals('p', connection.getInputStream().read());
        assertEquals(PlayerDocument.BROWSER_USER_AGENT, server.takeRequest().getHeader("User-Agent"));
      } finally { connection.disconnect(); }
    }
  }

  @Test public void chromiumHlsActuallyDecodesInCalamarNativePlayer() throws Exception {
    Buffer video = new Buffer();
    try (InputStream in = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        .getContext().getAssets().open("live.ts")) {
      byte[] block = new byte[8192]; for (int n; (n = in.read(block)) != -1;) video.write(block, 0, n);
    }
    AtomicBoolean chromiumRequest = new AtomicBoolean();
    try (MockWebServer server = new MockWebServer()) {
      server.setDispatcher(new Dispatcher() {
        @Override public MockResponse dispatch(RecordedRequest request) {
          if (PlayerDocument.BROWSER_USER_AGENT.equals(request.getHeader("User-Agent"))) chromiumRequest.set(true);
          if (request.getPath().startsWith("/live.m3u8")) return new MockResponse()
              .setHeader("Content-Type", "application/vnd.apple.mpegurl")
              .setBody("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:20\n#EXTINF:20,\nsegment.ts\n#EXT-X-ENDLIST\n");
          return new MockResponse().setHeader("Content-Type", "video/mp2t").setBody(video.clone());
        }
      });
      server.start();
      DnsProvider previous = NetworkTransport.selected(ApplicationProvider.getApplicationContext());
      NetworkTransport.select(ApplicationProvider.getApplicationContext(), DnsProvider.SYSTEM);
      Intent intent = new Intent(ApplicationProvider.getApplicationContext(), NativePlayerActivity.class)
          .putExtra("media_url", server.url("/live.m3u8").toString()).putExtra("title", "Prueba Chromium nativo");
      try (ActivityScenario<NativePlayerActivity> scenario = ActivityScenario.launch(intent)) {
        scenario.onActivity(activity -> {
          try {
            Method release = NativePlayerActivity.class.getDeclaredMethod("releasePlayer"); release.setAccessible(true); release.invoke(activity);
            Field chromium = NativePlayerActivity.class.getDeclaredField("chromiumNetwork"); chromium.setAccessible(true); chromium.setBoolean(activity, true);
            Method resolve = NativePlayerActivity.class.getDeclaredMethod("resolveFresh"); resolve.setAccessible(true); resolve.invoke(activity);
          } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
        });
        AtomicBoolean playing = new AtomicBoolean(); long deadline = SystemClock.elapsedRealtime() + 25000;
        while (!playing.get() && SystemClock.elapsedRealtime() < deadline) {
          scenario.onActivity(activity -> {
            try {
              Field field = NativePlayerActivity.class.getDeclaredField("player"); field.setAccessible(true);
              ExoPlayer player = (ExoPlayer) field.get(activity);
              playing.set(player != null && player.isPlaying() && player.getVideoSize().width > 0 && player.getCurrentPosition() > 300);
            } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
          });
          SystemClock.sleep(100);
        }
        assertTrue("The native Chromium HLS connection did not decode video", playing.get());
        assertTrue("Chromium was not used for the HLS request", chromiumRequest.get());
      } finally { NetworkTransport.select(ApplicationProvider.getApplicationContext(), previous); }
    }
  }
}
