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
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.mockwebserver.*;
import okio.Buffer;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class AccountAccessPlaybackTest {
  static class Authority implements AccountAccess.Authority {
    AccountAccess.State state;
    final List<AccountAccess.Listener> listeners=new ArrayList<>();
    int claims,released;String rejection;
    Authority(AccountAccess.State state){this.state=state;}
    public Runnable watch(AccountAccess.Listener listener){listeners.add(listener);listener.changed(state);return ()->listeners.remove(listener);}
    void update(AccountAccess.State next){state=next;for(AccountAccess.Listener l:new ArrayList<>(listeners))l.changed(next);}
    public void claim(String title,int count,AccountAccess.Completion<AccountAccess.Lease> done){
      claims++;
      if(rejection!=null)done.done(null,new IllegalStateException(rejection));
      else done.done(new AccountAccess.Lease("viewer","aabbccddeeff00112233445566778899",title,"main","android",Collections.singletonList(0)),null);
    }
    public void beat(AccountAccess.Lease lease,AccountAccess.Completion<Void> done){done.done(null,null);}
    public void release(AccountAccess.Lease lease){released++;}
  }
  @Test public void cachedUnknownStateWaitsAndSigningInReservesTheExistingAnonymousPlayer(){
    Authority authority=new Authority(new AccountAccess.State(false,false,false,"",0,1));
    AccountAccess.factory=context->authority;
    try{
      androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
        int[] plays={0};List<String> reasons=new ArrayList<>();
        AccountAccess.Playback playback=new AccountAccess.Playback(ApplicationProvider.getApplicationContext(),"Canal",1,()->plays[0]++,reasons::add);
        playback.start();assertFalse(playback.allowed());assertEquals(0,plays[0]);
        authority.update(new AccountAccess.State(true,false,false,"",0,1));
        assertTrue(playback.allowed());assertEquals(1,plays[0]);assertEquals(0,authority.claims);
        authority.update(new AccountAccess.State(true,false,true,"viewer",0,1));
        assertTrue(playback.allowed());assertEquals(2,plays[0]);assertEquals(1,authority.claims);
        authority.update(new AccountAccess.State(true,true,false,"",0,1));
        assertFalse(playback.allowed());assertEquals(1,authority.released);
        playback.close();assertEquals(1,authority.released);
      });
    }finally{AccountAccess.factory=context->CalamarTestRunner.LOCAL;}
  }
  @Test public void anonymousAccountCannotRequestAnyMedia()throws Exception{deny(new AccountAccess.State(true,true,false,"",0,1),null,false);}
  @Test public void expiredAccountCannotRequestAnyMedia()throws Exception{deny(new AccountAccess.State(true,true,true,"viewer",System.currentTimeMillis()-1000,1),null,false);}
  @Test public void fullAccountCannotLoadTheDailymotionPlayerEither()throws Exception{deny(new AccountAccess.State(true,true,true,"viewer",0,1),"Se ha superado el límite de reproducciones simultáneas de tu cuenta (1 pantalla).",true);}
  private void deny(AccountAccess.State state,String reason,boolean daily)throws Exception{
    Authority authority=new Authority(state);authority.rejection=reason;AccountAccess.factory=context->authority;
    try(MockWebServer server=new MockWebServer()){
      server.enqueue(new MockResponse().setResponseCode(500));server.start();
      Intent intent=new Intent(ApplicationProvider.getApplicationContext(),NativePlayerActivity.class).putExtra("title","Acceso");
      if(daily)intent.putExtra("page_url","https://geo.dailymotion.com/player/x1k3pa.html?video=k5cyQ3rl70nCl7Fhb5W");
      else intent.putExtra("media_url",server.url("/live.ts").toString());
      try(ActivityScenario<NativePlayerActivity> scenario=ActivityScenario.launch(intent)){
        SystemClock.sleep(300);
        scenario.onActivity(activity->{try{
          Field p=NativePlayerActivity.class.getDeclaredField("player");p.setAccessible(true);assertNull(p.get(activity));
          Field b=NativePlayerActivity.class.getDeclaredField("browser");b.setAccessible(true);assertNull(b.get(activity));
          Field text=NativePlayerActivity.class.getDeclaredField("status");text.setAccessible(true);
          String message=((android.widget.TextView)text.get(activity)).getText().toString();
          assertTrue(message,message.contains(reason==null?(state.signed?"caducado":"Entra"):"límite de reproducciones"));
        }catch(ReflectiveOperationException e){throw new AssertionError(e);}});
        assertEquals(0,server.getRequestCount());
      }
    }finally{AccountAccess.factory=context->CalamarTestRunner.LOCAL;}
  }
  @Test public void expiryStopsAnAlreadyPlayingVideoOnPhoneAndTv()throws Exception{
    Authority authority=new Authority(new AccountAccess.State(true,true,true,"viewer",0,1));AccountAccess.factory=context->authority;
    Buffer video=new Buffer();try(InputStream in=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("live.ts")){
      byte[] block=new byte[8192];for(int n;(n=in.read(block))!=-1;)video.write(block,0,n);
    }
    try(MockWebServer server=new MockWebServer()){
      server.enqueue(new MockResponse().setHeader("Content-Type","video/mp2t").setChunkedBody(video,1316));server.start();
      NetworkTransport.select(ApplicationProvider.getApplicationContext(),DnsProvider.CLOUDFLARE);
      Intent intent=new Intent(ApplicationProvider.getApplicationContext(),NativePlayerActivity.class).putExtra("media_url",server.url("/live.ts").toString()).putExtra("title","Acceso");
      try(ActivityScenario<NativePlayerActivity> scenario=ActivityScenario.launch(intent)){
        AtomicBoolean playing=new AtomicBoolean();long until=SystemClock.elapsedRealtime()+20000;
        while(!playing.get()&&SystemClock.elapsedRealtime()<until){
          scenario.onActivity(activity->{try{Field f=NativePlayerActivity.class.getDeclaredField("player");f.setAccessible(true);ExoPlayer p=(ExoPlayer)f.get(activity);playing.set(p!=null&&p.isPlaying()&&p.getVideoSize().width>0&&p.getCurrentPosition()>300);}catch(Exception e){throw new AssertionError(e);}});
          SystemClock.sleep(100);
        }
        if(!playing.get())scenario.onActivity(activity->{try{
          Field f=NativePlayerActivity.class.getDeclaredField("status");f.setAccessible(true);
          fail("The reserved screen must play actual video; claims="+authority.claims+", requests="+server.getRequestCount()+", status="+((android.widget.TextView)f.get(activity)).getText());
        }catch(ReflectiveOperationException e){throw new AssertionError(e);}});
        assertEquals(1,authority.claims);
        scenario.onActivity(activity->authority.update(new AccountAccess.State(true,true,true,"viewer",System.currentTimeMillis()-1000,1)));
        scenario.onActivity(activity->{try{Field f=NativePlayerActivity.class.getDeclaredField("player");f.setAccessible(true);assertNull("Expiry must release the media player",f.get(activity));}catch(Exception e){throw new AssertionError(e);}});
        assertEquals(1,authority.released);
      }
    }finally{AccountAccess.factory=context->CalamarTestRunner.LOCAL;}
  }
}
