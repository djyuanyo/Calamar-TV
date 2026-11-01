package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.widget.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.atomic.*;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import okhttp3.tls.*;
import okio.Buffer;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
@androidx.test.filters.SdkSuppress(minSdkVersion=26)
public class MultiPlaybackTest {
  interface Check { void run() throws Exception; }
  static void main(Check check) {
    AtomicReference<Throwable> error=new AtomicReference<>();
    InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{check.run();}catch(Throwable e){error.set(e);}});
    if(error.get()!=null)throw new AssertionError(error.get());
  }
  static Object field(Object object,String name)throws Exception{Field f=object.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(object);}
  static List<?> tiles(MultiPlayerActivity activity)throws Exception{Field f=MultiPlayerActivity.class.getDeclaredField("tiles");f.setAccessible(true);return (List<?>)f.get(activity);}
  static List<ExoPlayer> players(MultiPlayerActivity activity)throws Exception{List<ExoPlayer> out=new ArrayList<>();for(Object tile:tiles(activity))out.add((ExoPlayer)field(tile,"player"));return out;}
  static void show(MultiPlayerActivity activity)throws Exception{Method m=MultiPlayerActivity.class.getDeclaredMethod("showControls",boolean.class);m.setAccessible(true);m.invoke(activity,true);}
  static void renders(MultiPlayerActivity activity,int count)throws Exception{
    long deadline=SystemClock.elapsedRealtime()+35000;AtomicBoolean done=new AtomicBoolean();
    while(!done.get()&&SystemClock.elapsedRealtime()<deadline){main(()->{List<ExoPlayer> ps=players(activity);done.set(ps.size()==count);for(ExoPlayer p:ps)done.set(done.get()&&p!=null&&p.isPlaying()&&p.getVideoSize().width>0&&p.getCurrentPosition()>300);});SystemClock.sleep(100);}
    if(!done.get()){StringBuilder detail=new StringBuilder();main(()->{for(Object tile:tiles(activity))detail.append(((TextView)field(tile,"status")).getText()).append(';');});fail("Every native tile must decode H264/AAC: "+detail);}
  }
  @Test public void playerSearchAddsUpToFourNativeWindowsThroughHostingAndKeepsTheFirst()throws Exception{
    Context context=ApplicationProvider.getApplicationContext();Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    NetworkTransport network=NetworkTransport.get(DnsProvider.SYSTEM);Field clientField=NetworkTransport.class.getDeclaredField("client");clientField.setAccessible(true);OkHttpClient original=(OkHttpClient)clientField.get(network);
    DnsProvider previous=NetworkTransport.selected(context);File cache=new File(context.getFilesDir(),"shared-catalog.json");byte[] previousCache=cache.isFile()?java.nio.file.Files.readAllBytes(cache.toPath()):null;
    JSONObject catalog=new JSONObject().put("channels",new JSONArray()).put("featured",new JSONArray()).put("hidden",new JSONArray());JSONArray events=new JSONArray();
    String[] names={"Águilas vs Betis","Evento Beta","Evento Gamma","Evento Delta"};
    for(int i=0;i<names.length;i++)events.put(new JSONObject().put("id","multi-fixture-"+i).put("name",names[i]).put("cover","https://example.invalid/cover.png").put("streams",new JSONArray().put("https://zicotv.cc/api/player/"+(i+2))));
    catalog.put("events",events);SharedCatalog.validate(catalog);SharedCatalog.cache(context,catalog);
    HeldCertificate cert=new HeldCertificate.Builder().commonName("calamarmenciano.com").addSubjectAlternativeName("calamarmenciano.com").addSubjectAlternativeName("www.calamarmenciano.com").build();
    HandshakeCertificates serverTls=new HandshakeCertificates.Builder().heldCertificate(cert).build(),tls=new HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate()).build();
    Buffer video=new Buffer();try(InputStream in=instrumentation.getContext().getAssets().open("live.ts")){byte[] block=new byte[8192];for(int n;(n=in.read(block))!=-1;)video.write(block,0,n);}
    AtomicInteger provider=new AtomicInteger(),lookups=new AtomicInteger();
    try(MockWebServer server=new MockWebServer()){
      server.useHttps(serverTls.sslSocketFactory(),false);server.start();server.setDispatcher(new Dispatcher(){@Override public MockResponse dispatch(RecordedRequest r){
        String path=r.getPath();
        if(path.contains("&list=1"))return new MockResponse().setBody("{\"sources\":1}");
        if(path.startsWith("/calamar-player.php?page=")){lookups.incrementAndGet();return new MockResponse().setBody("{\"url\":\"calamar-player.php?seg=playlist&sig=ok\"}");}
        if(path.startsWith("/calamar-player.php?seg=playlist")){StringBuilder list=new StringBuilder("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:9\n");for(int i=0;i<8;i++){if(i>0)list.append("#EXT-X-DISCONTINUITY\n");list.append("#EXTINF:8.023,\ncalamar-player.php?seg=video&sig=ok&n=").append(i).append('\n');}return new MockResponse().setHeader("Content-Type","application/vnd.apple.mpegurl").setBody(list.append("#EXT-X-ENDLIST\n").toString());}
        if(path.startsWith("/calamar-player.php?seg=video"))return new MockResponse().setHeader("Content-Type","video/mp2t").setBody(video.clone());
        provider.incrementAndGet();return new MockResponse().setResponseCode(404);
      }});
      OkHttpClient local=new OkHttpClient.Builder().readTimeout(20,java.util.concurrent.TimeUnit.SECONDS).sslSocketFactory(tls.sslSocketFactory(),tls.trustManager())
          .dns(host->{if(host.equals("calamarmenciano.com"))throw new UnknownHostException("Root unavailable");return Collections.singletonList(InetAddress.getByName("127.0.0.1"));})
          .addInterceptor(chain->{if(chain.request().url().host().endsWith("zicotv.cc"))provider.incrementAndGet();return chain.proceed(chain.request().newBuilder().url(chain.request().url().newBuilder().port(server.getPort()).build()).build());}).build();
      clientField.set(network,local);NetworkTransport.select(context,DnsProvider.SYSTEM);
      AtomicReference<Intent> launch=new AtomicReference<>();
      Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){if(intent.getComponent()!=null&&intent.getComponent().getClassName().equals(MultiPlayerActivity.class.getName())){launch.set(new Intent(intent));return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null);}return null;}};
      instrumentation.addMonitor(monitor);
      try(ActivityScenario<NativePlayerActivity> single=ActivityScenario.launch(new Intent(context,NativePlayerActivity.class).putExtra("page_url","https://zicotv.cc/api/player/1").putExtra("title","Canal inicial"))){
        long deadline=SystemClock.elapsedRealtime()+30000;AtomicBoolean playing=new AtomicBoolean();
        while(!playing.get()&&SystemClock.elapsedRealtime()<deadline){single.onActivity(a->{try{ExoPlayer p=(ExoPlayer)field(a,"player");playing.set(p!=null&&p.isPlaying()&&p.getVideoSize().width>0);}catch(Exception e){throw new AssertionError(e);}});SystemClock.sleep(100);}assertTrue(playing.get());
        onView(withContentDescription("Multipantalla")).perform(scrollTo(),click());
        onView(withContentDescription("Buscar evento para multipantalla")).perform(replaceText("no existe"),closeSoftKeyboard());onView(withText("No hay eventos con ese nombre.")).check(matches(isDisplayed()));
        onView(withContentDescription("Buscar evento para multipantalla")).perform(replaceText("aguilas"),closeSoftKeyboard());onView(withContentDescription(names[0])).perform(click());
        assertNotNull(launch.get());assertEquals(Arrays.asList("Canal inicial",names[0]),launch.get().getStringArrayListExtra(MultiPlayerActivity.TITLES));
      }finally{instrumentation.removeMonitor(monitor);}
      assertNotNull(launch.get());Intent multiIntent=launch.get().setClass(context,MultiFixtureActivity.class);
      try(ActivityScenario<MultiFixtureActivity> multi=ActivityScenario.launch(multiIntent)){
        AtomicReference<MultiFixtureActivity> activity=new AtomicReference<>();multi.onActivity(activity::set);renders(activity.get(),2);
        AtomicReference<ExoPlayer> first=new AtomicReference<>();main(()->first.set(players(activity.get()).get(0)));
        for(String name:new String[]{names[1],names[2]}){
          main(()->show(activity.get()));onView(withContentDescription("Añadir evento a multipantalla")).perform(click());
          onView(withContentDescription("Buscar evento para multipantalla")).perform(replaceText(name),closeSoftKeyboard());onView(withContentDescription(name)).perform(click());
        }
        renders(activity.get(),4);main(()->{assertSame("Earlier tiles must keep their player",first.get(),players(activity.get()).get(0));show(activity.get());});
        onView(withContentDescription("Añadir evento a multipantalla")).check(matches(org.hamcrest.Matchers.not(isEnabled())));
        main(()->{int audible=0;for(ExoPlayer p:players(activity.get()))if(p.getVolume()>0)audible++;assertEquals(1,audible);});
        onView(withContentDescription("Quitar "+names[2])).perform(click());renders(activity.get(),3);
        main(()->{assertSame(first.get(),players(activity.get()).get(0));show(activity.get());});
        onView(withContentDescription("Añadir evento a multipantalla")).check(matches(isEnabled()));
      }
      assertEquals("No device request may contact the provider",0,provider.get());assertTrue(lookups.get()>=4);
    }finally{clientField.set(network,original);NetworkTransport.select(context,previous);if(previousCache==null)cache.delete();else java.nio.file.Files.write(cache.toPath(),previousCache);}
  }
}
