package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static androidx.test.espresso.matcher.RootMatchers.isDialog;
import static androidx.test.espresso.action.ViewActions.click;
import android.content.Intent;
import android.os.SystemClock;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.lang.reflect.Field;
import java.net.InetAddress;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.OkHttpClient;
import okhttp3.mockwebserver.*;
import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;
import okio.Buffer;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Own app and local TLS fixtures only. Never connects to MadPlay77 or an actual hosting service. */
@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class MadplayHostedPlaybackTest {
  private static final String PAGE="https://jack21eo.mpanrc4imind.my/es/football/russian-cup-4436876/cska-moscow-vs-lokomotiv-moscow.html?icg=RVM";
  private static final String BASE=MadplayPlayback.ENDPOINT+"/match/4436876";
  @Test public void hostedSourcesPlaySwitchAndKeepTheSelectedSignalOnRefresh()throws Exception{playback(true);}
  @Test public void disabledHostingNeverFallsBackToProviderWebView()throws Exception{playback(false);}
  private void playback(boolean available)throws Exception{
    HeldCertificate cert=new HeldCertificate.Builder().commonName("calamarmenciano.com").addSubjectAlternativeName("calamarmenciano.com").build();
    HandshakeCertificates serverTls=new HandshakeCertificates.Builder().heldCertificate(cert).build();
    HandshakeCertificates tls=new HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate()).build();
    Buffer video=new Buffer();try(java.io.InputStream in=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("live.ts")){byte[] b=new byte[8192];for(int n;(n=in.read(b))!=-1;)video.write(b,0,n);}
    AtomicInteger menus=new AtomicInteger(),roots=new AtomicInteger(),pieces=new AtomicInteger(),provider=new AtomicInteger();AtomicReference<String> signal=new AtomicReference<>("");
    try(MockWebServer server=new MockWebServer()){
      server.useHttps(serverTls.sslSocketFactory(),false);server.start();
      server.setDispatcher(new Dispatcher(){public MockResponse dispatch(RecordedRequest r){String path=r.getPath();
        if(path.endsWith("/sources.json")){menus.incrementAndGet();return available?new MockResponse().setHeader("Content-Type","application/json").setBody("{\"items\":[{\"id\":905919,\"name\":\"VIX ES\",\"url\":\""+BASE+"/source/905919/index.m3u8\"},{\"id\":901559,\"name\":\"English\",\"url\":\""+BASE+"/source/901559/index.m3u8\"}]}"):new MockResponse().setResponseCode(503);}
        if(path.endsWith("/index.m3u8")){signal.set(path.contains("905919")?"905919":"901559");int generation=roots.incrementAndGet();return new MockResponse().setHeader("Content-Type","application/vnd.apple.mpegurl").setBody("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:20\n#EXTINF:20,\nasset/piece.bin?session="+generation+"\n#EXT-X-ENDLIST\n");}
        if(path.contains("/asset/piece.bin")){pieces.incrementAndGet();return new MockResponse().setHeader("Content-Type","video/mp2t").setBody(video.clone());}
        return new MockResponse().setResponseCode(404);
      }});
      NetworkTransport transport=NetworkTransport.get(DnsProvider.SYSTEM);Field client=NetworkTransport.class.getDeclaredField("client");client.setAccessible(true);OkHttpClient original=(OkHttpClient)client.get(transport);
      android.content.Context context=ApplicationProvider.getApplicationContext();DnsProvider previous=NetworkTransport.selected(context);
      OkHttpClient local=new OkHttpClient.Builder().sslSocketFactory(tls.sslSocketFactory(),tls.trustManager()).dns(host->Collections.singletonList(InetAddress.getByName("127.0.0.1"))).addInterceptor(chain->{if(!chain.request().url().host().equals("calamarmenciano.com")){provider.incrementAndGet();throw new java.io.IOException("Provider requests are forbidden in this test");}return chain.proceed(chain.request().newBuilder().url(chain.request().url().newBuilder().port(server.getPort()).build()).build());}).build();
      client.set(transport,local);NetworkTransport.select(context,DnsProvider.SYSTEM);
      try(ActivityScenario<NativePlayerActivity> scenario=ActivityScenario.launch(new Intent(context,NativePlayerActivity.class).putExtra("page_url",PAGE).putExtra("title","CSKA Lokomotiv Prueba"))){
        if(!available){AtomicBoolean pending=new AtomicBoolean();long until=SystemClock.elapsedRealtime()+12000;while(!pending.get()&&SystemClock.elapsedRealtime()<until){scenario.onActivity(a->{try{Field f=NativePlayerActivity.class.getDeclaredField("status");f.setAccessible(true);pending.set(((android.widget.TextView)f.get(a)).getText().toString().contains("pendiente de verificar"));}catch(Exception e){throw new AssertionError(e);}});SystemClock.sleep(80);}assertTrue("Disabled integration must be explicit",pending.get());assertEquals(0,roots.get());assertEquals(0,provider.get());return;}
        assertPlays(scenario);assertTrue(pieces.get()>0);assertEquals("905919",signal.get());
        boolean tv=(context.getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_TYPE_MASK)==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION;
        if(tv){androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_UP);androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_CENTER);}
        else scenario.onActivity(a->{try{Field f=NativePlayerActivity.class.getDeclaredField("sourceButton");f.setAccessible(true);((android.widget.Button)f.get(a)).performClick();}catch(Exception e){throw new AssertionError(e);}});
        onView(withText("English")).inRoot(isDialog()).perform(click());assertPlays(scenario);assertEquals("901559",signal.get());int before=menus.get();
        scenario.onActivity(a->{try{java.lang.reflect.Method m=NativePlayerActivity.class.getDeclaredMethod("resolveFresh");m.setAccessible(true);m.invoke(a);}catch(Exception e){throw new AssertionError(e);}});
        long until=SystemClock.elapsedRealtime()+12000;while(menus.get()<=before&&SystemClock.elapsedRealtime()<until)SystemClock.sleep(80);assertTrue(menus.get()>before);assertPlays(scenario);assertEquals("901559",signal.get());assertEquals(0,provider.get());
      }finally{client.set(transport,original);NetworkTransport.select(context,previous);}
    }
  }
  private void assertPlays(ActivityScenario<NativePlayerActivity> scenario){AtomicBoolean ok=new AtomicBoolean();long until=SystemClock.elapsedRealtime()+20000;while(!ok.get()&&SystemClock.elapsedRealtime()<until){scenario.onActivity(a->{try{Field f=NativePlayerActivity.class.getDeclaredField("player");f.setAccessible(true);ExoPlayer p=(ExoPlayer)f.get(a);if(p!=null){p.setRepeatMode(androidx.media3.common.Player.REPEAT_MODE_ONE);ok.set(p.isPlaying()&&p.getVideoSize().width>0);}}catch(Exception e){throw new AssertionError(e);}});SystemClock.sleep(80);}assertTrue("Synthetic hosted HLS must render video",ok.get());}
}
