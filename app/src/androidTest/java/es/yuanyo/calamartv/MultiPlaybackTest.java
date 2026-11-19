package es.yuanyo.calamartv;

import static org.junit.Assert.*;
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
  static Object field(Object object,String name)throws Exception{
    for(Class<?> type=object.getClass();type!=null;type=type.getSuperclass())try{Field f=type.getDeclaredField(name);f.setAccessible(true);return f.get(object);}catch(NoSuchFieldException next){}
    throw new NoSuchFieldException(name);
  }
  static <T extends android.view.View> T find(android.view.View root,Class<T> kind,String description){
    if(kind.isInstance(root)&&(description==null||description.contentEquals(root.getContentDescription()==null?"":root.getContentDescription())))return kind.cast(root);
    if(root instanceof android.view.ViewGroup){android.view.ViewGroup group=(android.view.ViewGroup)root;for(int i=0;i<group.getChildCount();i++){T child=find(group.getChildAt(i),kind,description);if(child!=null)return child;}}
    return null;
  }
  static String windowFocus(){
    Context context=ApplicationProvider.getApplicationContext();StringBuilder focus=new StringBuilder();
    focus.append("interactive=").append(((android.os.PowerManager)context.getSystemService(Context.POWER_SERVICE)).isInteractive()).append(", keyguard=").append(((android.app.KeyguardManager)context.getSystemService(Context.KEYGUARD_SERVICE)).isKeyguardLocked()).append(';');
    try{android.graphics.Bitmap screenshot=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();if(screenshot!=null)try(OutputStream out=context.openFileOutput("multi-focus.png",Context.MODE_PRIVATE)){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);screenshot.recycle();}}catch(Exception ignored){}
    try(InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys window"))){
      for(String line:Io.read(input).split("\n"))if(line.contains("mCurrentFocus=")||line.contains("mFocusedApp=")||line.contains("mTopFocusedDisplayId="))focus.append(line.trim()).append(';');
    }catch(Exception error){focus.append(error.getClass().getSimpleName());}return focus.toString();
  }
  static Dialog picker(Activity activity)throws Exception{
    AtomicReference<Dialog> value=new AtomicReference<>();AtomicReference<String> detail=new AtomicReference<>();AtomicBoolean focused=new AtomicBoolean();long deadline=SystemClock.elapsedRealtime()+10000;
    while(!focused.get()&&SystemClock.elapsedRealtime()<deadline){main(()->{Dialog d=(Dialog)field(activity,activity instanceof MultiPlayerActivity?"picker":"multiPicker");value.set(d);focused.set(d!=null&&d.isShowing()&&d.getWindow().getDecorView().hasWindowFocus());detail.set("dialog="+(d==null?"null":("showing="+d.isShowing()+", flags="+d.getWindow().getAttributes().flags+", focus="+d.getCurrentFocus()))+", activityFocus="+activity.hasWindowFocus()+", active="+field(activity,"active")+", tiles="+(activity instanceof MultiPlayerActivity?tiles((MultiPlayerActivity)activity).size():1));});SystemClock.sleep(100);}
    assertTrue("The event selector must receive real input focus: "+detail.get()+(focused.get()?"":"; "+windowFocus()),focused.get());return value.get();
  }
  static void search(Dialog dialog,String query)throws Exception{main(()->{EditText input=find(dialog.getWindow().getDecorView(),EditText.class,"Buscar evento para multipantalla");assertNotNull(input);assertTrue(input.isShown());input.setText(query);});}
  static void choose(Dialog dialog,String name)throws Exception{
    search(dialog,name);main(()->{GridView list=find(dialog.getWindow().getDecorView(),GridView.class,null);assertNotNull(list);assertEquals(1,list.getAdapter().getCount());assertTrue(list.getAdapter().isEnabled(0));
      assertEquals(name,((Catalog.Channel)list.getAdapter().getItem(0)).name);android.view.View row=list.getAdapter().getView(0,null,list);assertTrue(row instanceof LinearLayout);assertNotNull(find(row,ImageView.class,null));assertNotNull(find(row,TextView.class,null));list.performItemClick(row,0,list.getAdapter().getItemId(0));});
  }
  static List<?> tiles(MultiPlayerActivity activity)throws Exception{Field f=MultiPlayerActivity.class.getDeclaredField("tiles");f.setAccessible(true);return (List<?>)f.get(activity);}
  static List<ExoPlayer> players(MultiPlayerActivity activity)throws Exception{List<ExoPlayer> out=new ArrayList<>();for(Object tile:tiles(activity))out.add((ExoPlayer)field(tile,"player"));return out;}
  static void show(MultiPlayerActivity activity)throws Exception{Method m=MultiPlayerActivity.class.getDeclaredMethod("showControls",boolean.class);m.setAccessible(true);m.invoke(activity,true);}
  static void foreground(Activity activity)throws Exception{
    AtomicBoolean focused=new AtomicBoolean();long deadline=SystemClock.elapsedRealtime()+10000;
    while(!focused.get()&&SystemClock.elapsedRealtime()<deadline){main(()->focused.set(activity.hasWindowFocus()));SystemClock.sleep(100);}
    assertTrue("The player must regain window focus after layout/rotation before the next click: "+(focused.get()?"":windowFocus()),focused.get());
  }
  static void renders(MultiPlayerActivity activity,int count)throws Exception{
    long deadline=SystemClock.elapsedRealtime()+35000;AtomicBoolean done=new AtomicBoolean();
    while(!done.get()&&SystemClock.elapsedRealtime()<deadline){main(()->{List<ExoPlayer> ps=players(activity);done.set(ps.size()==count);for(ExoPlayer p:ps)done.set(done.get()&&p!=null&&p.isPlaying()&&p.getVideoSize().width>0&&p.getCurrentPosition()>300);});SystemClock.sleep(100);}
    if(!done.get()){StringBuilder detail=new StringBuilder();main(()->{for(Object tile:tiles(activity)){ExoPlayer p=(ExoPlayer)field(tile,"player");detail.append(((TextView)field(tile,"status")).getText()).append(" loading=").append(field(tile,"loading")).append(" resolved=").append(field(tile,"resolved")!=null);if(p!=null){detail.append(" state=").append(p.getPlaybackState()).append(" playing=").append(p.isPlaying()).append(" size=").append(p.getVideoSize().width).append(" position=").append(p.getCurrentPosition()).append(" videoQueued=").append(p.getVideoDecoderCounters()==null?-1:p.getVideoDecoderCounters().queuedInputBufferCount).append(" videoRendered=").append(p.getVideoDecoderCounters()==null?-1:p.getVideoDecoderCounters().renderedOutputBufferCount).append(" error=").append(p.getPlayerError()==null?"none":p.getPlayerError().getErrorCodeName());}detail.append(';');}});fail("Every native tile must decode H264/AAC: destroyed="+activity.isDestroyed()+", changing="+activity.getChangingConfigurations()+", "+detail);}
  }
  @Test public void playerSearchAddsUpToFourNativeWindowsThroughHostingAndKeepsTheFirst()throws Exception{
    Context context=ApplicationProvider.getApplicationContext();Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    NetworkTransport network=NetworkTransport.get(DnsProvider.SYSTEM);Field clientField=NetworkTransport.class.getDeclaredField("client");clientField.setAccessible(true);OkHttpClient original=(OkHttpClient)clientField.get(network);
    DnsProvider previous=NetworkTransport.selected(context);File cache=new File(context.getFilesDir(),"shared-catalog.json");byte[] previousCache=cache.isFile()?java.nio.file.Files.readAllBytes(cache.toPath()):null;
    JSONObject catalog=new JSONObject().put("channels",new JSONArray()).put("featured",new JSONArray()).put("hidden",new JSONArray());JSONArray events=new JSONArray();
    String[] names={"Águilas vs Betis","Evento Beta","Evento Gamma","Evento Delta"};
    String pixel="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=";
    catalog.put("leagues",new JSONArray().put(new JSONObject().put("id","league-fixture").put("name","Liga de prueba")));
    catalog.put("teams",new JSONArray().put(new JSONObject().put("id","home-fixture").put("name","Águilas").put("logo",pixel)).put(new JSONObject().put("id","away-fixture").put("name","Betis").put("logo",pixel)));
    for(int i=0;i<names.length;i++)events.put(new JSONObject().put("id","multi-fixture-"+i).put("name",names[i]).put("cover",pixel).put("leagueId","league-fixture").put("homeTeamId","home-fixture").put("awayTeamId","away-fixture").put("streams",new JSONArray().put("https://zicotv.cc/api/player/"+(i+2))));
    catalog.put("events",events);SharedCatalog.validate(catalog);SharedCatalog.cache(context,catalog);
    HeldCertificate cert=new HeldCertificate.Builder().commonName("calamarmenciano.com").addSubjectAlternativeName("calamarmenciano.com").addSubjectAlternativeName("www.calamarmenciano.com").build();
    HandshakeCertificates serverTls=new HandshakeCertificates.Builder().heldCertificate(cert).build(),tls=new HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate()).build();
    Buffer video=new Buffer();try(InputStream in=instrumentation.getContext().getAssets().open("live.ts")){byte[] block=new byte[8192];for(int n;(n=in.read(block))!=-1;)video.write(block,0,n);}
    AtomicInteger provider=new AtomicInteger(),lookups=new AtomicInteger();
    try(MockWebServer server=new MockWebServer()){
      server.useHttps(serverTls.sslSocketFactory(),false);server.start();server.setDispatcher(new okhttp3.mockwebserver.Dispatcher(){@Override public MockResponse dispatch(RecordedRequest r){
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
      try(ActivityScenario<NativePlayerActivity> movie=ActivityScenario.launch(new Intent(context,NativePlayerActivity.class).putExtra("page_url","https://zicotv.cc/api/player/1").putExtra("title","Película de prueba").putExtra("progress_entry","{\"key\":\"vod-fixture\",\"page\":\"peliculas\",\"item\":\"vod-fixture\"}"))){
        movie.onActivity(a->{try{android.view.View button=find(a.getWindow().getDecorView(),android.view.View.class,"Multipantalla");assertNotNull(button);assertEquals(android.view.View.GONE,button.getVisibility());Method choose=NativePlayerActivity.class.getDeclaredMethod("chooseMultiEvent");choose.setAccessible(true);choose.invoke(a);assertNull(field(a,"multiPicker"));}catch(Exception e){throw new AssertionError(e);}});assertNull("A film must never launch multi-screen",launch.get());
      }
      try(ActivityScenario<NativePlayerActivity> single=ActivityScenario.launch(new Intent(context,NativePlayerActivity.class).putExtra("page_url","https://zicotv.cc/api/player/1").putExtra("title","Canal inicial"))){
        long deadline=SystemClock.elapsedRealtime()+30000;AtomicBoolean playing=new AtomicBoolean();
        while(!playing.get()&&SystemClock.elapsedRealtime()<deadline){single.onActivity(a->{try{ExoPlayer p=(ExoPlayer)field(a,"player");playing.set(p!=null&&p.isPlaying()&&p.getVideoSize().width>0);}catch(Exception e){throw new AssertionError(e);}});SystemClock.sleep(100);}assertTrue(playing.get());
        AtomicReference<NativePlayerActivity> originalActivity=new AtomicReference<>();single.onActivity(originalActivity::set);
        main(()->{((androidx.media3.ui.PlayerView)field(originalActivity.get(),"playerView")).showController();android.view.View button=find(originalActivity.get().getWindow().getDecorView(),android.view.View.class,"Multipantalla");assertNotNull(button);assertTrue(button.isShown());button.requestFocus();button.performClick();});
        Dialog selector=picker(originalActivity.get());main(()->{GridView grid=find(selector.getWindow().getDecorView(),GridView.class,null);assertNotNull(grid);if((context.getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_TYPE_MASK)==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION)assertTrue("TV selector must have multiple columns",grid.getNumColumns()>=2);});search(selector,"no existe");main(()->assertEquals(0,find(selector.getWindow().getDecorView(),GridView.class,null).getAdapter().getCount()));
        search(selector,"aguilas");main(()->assertEquals(1,find(selector.getWindow().getDecorView(),GridView.class,null).getAdapter().getCount()));choose(selector,names[0]);
        assertNotNull(launch.get());assertEquals(Arrays.asList("Canal inicial",names[0]),launch.get().getStringArrayListExtra(MultiPlayerActivity.TITLES));
      }finally{instrumentation.removeMonitor(monitor);}
      assertNotNull(launch.get());Intent multiIntent=launch.get().setClass(context,MultiFixtureActivity.class);
      try(ActivityScenario<MultiFixtureActivity> multi=ActivityScenario.launch(multiIntent)){
        AtomicReference<MultiFixtureActivity> activity=new AtomicReference<>();multi.onActivity(activity::set);renders(activity.get(),2);foreground(activity.get());
        AtomicReference<ExoPlayer> first=new AtomicReference<>();main(()->first.set(players(activity.get()).get(0)));
        int expected=3;for(String name:new String[]{names[1],names[2]}){
          main(()->{show(activity.get());((Button)field(activity.get(),"addButton")).performClick();});choose(picker(activity.get()),name);renders(activity.get(),expected++);foreground(activity.get());
        }
        renders(activity.get(),4);main(()->{assertSame("Earlier tiles must keep their player",first.get(),players(activity.get()).get(0));show(activity.get());});
        main(()->{Button add=(Button)field(activity.get(),"addButton");assertFalse(add.isEnabled());add.performClick();assertEquals(4,tiles(activity.get()).size());assertFalse(((Dialog)field(activity.get(),"picker")).isShowing());});
        main(()->{((Button)field(tiles(activity.get()).get(1),"sound")).performClick();int audible=0;for(ExoPlayer p:players(activity.get()))if(p.getVolume()>0)audible++;assertEquals(1,audible);assertEquals(1f,players(activity.get()).get(1).getVolume(),0f);((Button)field(tiles(activity.get()).get(0),"sound")).performClick();});renders(activity.get(),4);
        main(()->{Object last=tiles(activity.get()).get(3);Button remove=(Button)field(last,"remove");assertTrue(remove.isShown());remove.performClick();});renders(activity.get(),3);
        main(()->{assertSame(first.get(),players(activity.get()).get(0));show(activity.get());});
        main(()->assertTrue(((Button)field(activity.get(),"addButton")).isEnabled()));
      }
      assertEquals("No device request may contact the provider",0,provider.get());assertTrue(lookups.get()>=4);
    }finally{clientField.set(network,original);NetworkTransport.select(context,previous);if(previousCache==null)cache.delete();else java.nio.file.Files.write(cache.toPath(),previousCache);}
  }
}
