package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import android.content.Intent;
import android.os.SystemClock;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.media3.exoplayer.ExoPlayer;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okio.Buffer;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Decode actual MPEG-TS over HTTP in the complete activity, including full-screen layout. */
@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class NativePlaybackTest {
  private MockResponse video() throws Exception {
    Buffer body = new Buffer();
    try (InputStream in = androidx.test.platform.app.InstrumentationRegistry
        .getInstrumentation().getContext().getAssets().open("live.ts")) {
      byte[] bytes = new byte[8192];
      for (int n; (n = in.read(bytes)) != -1;) body.write(bytes, 0, n);
    }
    return new MockResponse().setHeader("Content-Type", "video/mp2t")
        .setChunkedBody(body, 1316).setBodyDelay(300, TimeUnit.MILLISECONDS);
  }

  @Test public void httpTsActuallyPlays() throws Exception { playback(false, "/live.ts"); }
  @Test public void stalledConnectionRetriesAndActuallyPlays() throws Exception { playback(true, "/live.ts"); }

  @Test public void httpHlsActuallyPlays() throws Exception { playback(false, "/live.m3u8"); }
  @Test public void extensionlessIptvActuallyPlays() throws Exception { playback(false, "/user/password/123"); }

  @Test public void publicHttpIptvPlaysThroughWebHostingTransport() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(video()); server.enqueue(video()); server.enqueue(video()); server.start();
      String original="http://31.43.191.125:8080/test-user/test-password/244";
      // A provider this device cannot reach: it goes through the hosting.
      HttpIptvDataSource.RELAYED.add("31.43.191.125:8080");
      Intent intent = new Intent(ApplicationProvider.getApplicationContext(), NativePlayerActivity.class)
          .putExtra("media_url",server.url("/bootstrap.ts").toString()).putExtra("title","Prueba puente HTTPS");
      try (ActivityScenario<NativePlayerActivity> scenario=ActivityScenario.launch(intent)) {
        scenario.onActivity(activity -> {
          try {
            java.lang.reflect.Method release=NativePlayerActivity.class.getDeclaredMethod("releasePlayer");
            release.setAccessible(true);release.invoke(activity);
            androidx.media3.datasource.DataSource.Factory factory=new HttpIptvDataSource.Factory(
                new androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(new okhttp3.OkHttpClient()),
                android.net.Uri.parse(server.url("/relay?stream=1").toString()));
            ExoPlayer player=new ExoPlayer.Builder(activity).setMediaSourceFactory(
                new androidx.media3.exoplayer.source.DefaultMediaSourceFactory(activity).setDataSourceFactory(factory)).build();
            Field field=NativePlayerActivity.class.getDeclaredField("player");field.setAccessible(true);field.set(activity,player);
            Field view=NativePlayerActivity.class.getDeclaredField("playerView");view.setAccessible(true);
            ((androidx.media3.ui.PlayerView)view.get(activity)).setPlayer(player);
            player.setMediaItem(new androidx.media3.common.MediaItem.Builder().setUri(original)
                .setMimeType(androidx.media3.common.MimeTypes.VIDEO_MP2T).build());
            player.prepare();player.play();
          } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
        });
        AtomicBoolean playing=new AtomicBoolean();long deadline=SystemClock.elapsedRealtime()+20000;
        while(!playing.get() && SystemClock.elapsedRealtime()<deadline) {
          scenario.onActivity(activity -> {
            try {
              Field f=NativePlayerActivity.class.getDeclaredField("player");f.setAccessible(true);ExoPlayer p=(ExoPlayer)f.get(activity);
              playing.set(p!=null && p.isPlaying() && p.getCurrentPosition()>300 && p.getVideoSize().width>0);
            } catch(ReflectiveOperationException error){throw new AssertionError(error);}
          }); SystemClock.sleep(100);
        }
        assertTrue("The hosting transport never decoded the IPTV stream",playing.get());
        boolean found=false;
        for(int i=0,n=server.getRequestCount();i<n;i++) {
          okhttp3.mockwebserver.RecordedRequest request=server.takeRequest(2,TimeUnit.SECONDS);
          if(request!=null && "/relay?stream=1".equals(request.getPath())) {
            assertEquals(original,new String(android.util.Base64.decode(request.getHeader("X-Calamar-Source"),android.util.Base64.DEFAULT),java.nio.charset.StandardCharsets.UTF_8));found=true;
          }
        }
        assertTrue("IPTV must use the web transport with credentials exclusively in the header",found);
      } finally { HttpIptvDataSource.RELAYED.clear(); }
    }
  }

  private void playback(boolean stalled, String path) throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      if (stalled) server.enqueue(video().throttleBody(1, 5, TimeUnit.SECONDS));
      boolean hls = path.endsWith(".m3u8");
      if (hls) server.enqueue(new MockResponse().setHeader("Content-Type", "application/vnd.apple.mpegurl")
          .setBody("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:20\n#EXTINF:20,\nlive.ts\n#EXT-X-ENDLIST\n"));
      server.enqueue(video());
      server.start();
      NetworkTransport.select(ApplicationProvider.getApplicationContext(), DnsProvider.CLOUDFLARE);
      Intent intent = new Intent(ApplicationProvider.getApplicationContext(), NativePlayerActivity.class)
          .putExtra("media_url", server.url(path).toString()).putExtra("title", "Prueba TS");
      try (ActivityScenario<NativePlayerActivity> scenario = ActivityScenario.launch(intent)) {
        AtomicBoolean playing = new AtomicBoolean();
        long deadline = SystemClock.elapsedRealtime() + (stalled ? 55000 : 20000);
        while (!playing.get() && SystemClock.elapsedRealtime() < deadline) {
          scenario.onActivity(activity -> {
            try {
              Field field = NativePlayerActivity.class.getDeclaredField("player");
              field.setAccessible(true);
              ExoPlayer player = (ExoPlayer) field.get(activity);
              if (player != null && player.isPlaying() && player.getCurrentPosition() > 300
                  && player.getVideoSize().width > 0 && player.getVideoSize().height > 0)
                playing.set(true);
            } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
          });
          SystemClock.sleep(100);
        }
        assertTrue("The native activity never decoded/played HTTP MPEG-TS", playing.get());
        assertEquals(stalled || hls ? 2 : 1, server.getRequestCount());
        if (stalled) scenario.onActivity(activity -> {
          try {
            Field field = NativePlayerActivity.class.getDeclaredField("mediaSystemRetry");
            field.setAccessible(true);
            assertTrue("A silent stall must switch to the device connection", field.getBoolean(activity));
          } catch (ReflectiveOperationException error) { throw new AssertionError(error); }
        });
      }
    }
  }
}
