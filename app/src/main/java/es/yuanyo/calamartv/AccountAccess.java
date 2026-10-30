package es.yuanyo.calamartv;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.google.firebase.Timestamp;
import com.google.firebase.auth.FirebaseUser;
import com.google.firebase.firestore.*;
import java.security.SecureRandom;
import java.util.*;

/** Account-wide playback reservations. The server's fixed slots arbitrate phones, TVs and web profiles. */
final class AccountAccess {
  static final long LEASE_MS = 90000, BEAT_MS = 30000;
  static final int MAX_SCREENS = 10;
  static final String LOGIN = "Entra con tu cuenta o regístrate para ver Calamar TV.";
  static final String EXPIRED = "Tu acceso ha caducado. Habla con el administrador para renovarlo.";
  interface Completion<T> { void done(T value, Exception error); }
  interface Listener { void changed(State state); }
  interface Factory { Authority create(Context context); }
  interface Authority {
    Runnable watch(Listener listener);
    void claim(String title, int count, Completion<Lease> done);
    void beat(Lease lease, Completion<Void> done);
    void release(Lease lease);
  }
  static Factory factory;
  private static Authority singleton;
  static synchronized Authority get(Context context) {
    if (factory != null) return factory.create(context);
    if (singleton == null) singleton = new FirebaseAuthority(context.getApplicationContext());
    return singleton;
  }
  static final class State {
    final boolean known, required, signed;
    final String uid;
    final long expires;
    final int screens;
    State(boolean known, boolean required, boolean signed, String uid, long expires, int screens) {
      this.known=known; this.required=required; this.signed=signed; this.uid=uid; this.expires=expires; this.screens=screens;
    }
    String problem() {
      if (!known) return "Comprobando el acceso a tu cuenta…";
      if (required && !signed) return LOGIN;
      if (signed && expires > 0 && expires <= System.currentTimeMillis()) return EXPIRED;
      return null;
    }
  }
  static final class Lease {
    final String uid, holder, title, profile, device;
    final List<Integer> slots;
    Lease(String uid, String holder, String title, String profile, String device, List<Integer> slots) {
      this.uid=uid;this.holder=holder;this.title=title;this.profile=profile;this.device=device;this.slots=slots;
    }
  }
  /** One instance belongs to one visible player; late claims cannot restart a closed/replaced player. */
  static final class Playback {
    private final Authority authority;
    private final String title;
    private final int count;
    private final Runnable play;
    private final java.util.function.Consumer<String> blocked;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable unwatch;
    private State state;
    private Lease lease;
    private boolean running, allowed, pending, rejected;
    private int generation;
    Playback(Context context, String title, int count, Runnable play, java.util.function.Consumer<String> blocked) {
      this.authority=get(context);this.title=title;this.count=count;this.play=play;this.blocked=blocked;
    }
    boolean allowed() { return running && allowed; }
    void start() {
      if (running) return;
      running=true;rejected=false;
      unwatch=authority.watch(next -> {
        if(state==null || !Objects.equals(state.uid,next.uid) || state.screens!=next.screens || state.expires!=next.expires || state.required!=next.required) rejected=false;
        state=next; check();
      });
    }
    void retry() { rejected=false;check(); }
    private void check() {
      if (!running || state == null) return;
      String reason=state.problem();
      if (reason != null) { revoke(reason); return; }
      if (lease != null && (!lease.uid.equals(state.uid) || lease.slots.stream().anyMatch(i -> i >= state.screens))) {
        revoke("Se ha superado el límite de reproducciones simultáneas de tu cuenta.");return;
      }
      handler.removeCallbacks(expiry);
      if (state.expires > 0) handler.postDelayed(expiry, Math.max(1, Math.min(2147483647L, state.expires-System.currentTimeMillis())));
      if (allowed || pending || rejected) return;
      if (!state.signed) { allowed=true;play.run();return; }
      pending=true;
      final int request=++generation;
      authority.claim(title,count,(value,error) -> {
        if (!running || request != generation) { if (value != null) authority.release(value);return; }
        pending=false;
        if (error != null) { rejected=true;blocked.accept(error.getMessage() == null ? "No se pudo reservar una pantalla. Vuelve a intentarlo." : error.getMessage());return; }
        lease=value;allowed=true;handler.postDelayed(heartbeat,BEAT_MS);play.run();
      });
    }
    private final Runnable expiry=() -> { if (running) check(); };
    private final Runnable heartbeat=new Runnable() {
      public void run() {
        if (!running || lease == null) return;
        final Lease current=lease;
        authority.beat(current,(value,error) -> {
          if (!running || lease != current) return;
          if (error != null) { revoke("Esta reproducción ya no dispone de acceso. Revisa la caducidad y el límite de pantallas.");rejected=true; }
          else handler.postDelayed(this,BEAT_MS);
        });
      }
    };
    private void revoke(String reason) {
      ++generation;pending=false;allowed=false;
      handler.removeCallbacks(heartbeat);handler.removeCallbacks(expiry);
      Lease old=lease;lease=null;if(old!=null)authority.release(old);
      blocked.accept(reason);
    }
    void close() {
      running=false;++generation;allowed=false;pending=false;
      handler.removeCallbacksAndMessages(null);
      if(unwatch!=null){unwatch.run();unwatch=null;}
      Lease old=lease;lease=null;if(old!=null)authority.release(old);
    }
  }
  private static String holder() {
    byte[] bytes=new byte[16];new SecureRandom().nextBytes(bytes);StringBuilder s=new StringBuilder();
    for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();
  }
  private static long millis(Object value) { return value instanceof Timestamp ? ((Timestamp)value).toDate().getTime() : 0; }
  static FirebaseFirestore database(Context context) { return FirebaseFirestore.getInstance(SharedCatalog.app(context)); }
  private static final class FirebaseAuthority implements Authority {
    final Context context;
    final FirebaseFirestore db;
    final List<Listener> listeners=new ArrayList<>();
    boolean settingsReady, authReady, rightsReady, required=true;
    String uid="";
    long expires;
    int screens=1, authGeneration;
    ListenerRegistration rights;
    FirebaseAuthority(Context context) {
      this.context=context;this.db=database(context);
      db.document("calamarSettings/access").addSnapshotListener((snapshot,error)->{
        settingsReady=error==null && snapshot!=null && !snapshot.getMetadata().isFromCache();
        if(settingsReady)required=!snapshot.exists() || !Boolean.FALSE.equals(snapshot.getBoolean("requireRegistration"));
        changed();
      });
      SharedCatalog.auth(context).addAuthStateListener(auth -> {
        int request=++authGeneration;
        if(rights!=null){rights.remove();rights=null;}
        FirebaseUser user=auth.getCurrentUser();uid=user==null?"":user.getUid();expires=0;screens=1;authReady=true;rightsReady=user==null;
        if(user!=null){
          Map<String,Object> member=new HashMap<>();member.put("email",user.getEmail()==null?"":user.getEmail());
          member.put("name",user.getDisplayName()==null?"":user.getDisplayName().substring(0,Math.min(100,user.getDisplayName().length())));member.put("seenAt",FieldValue.serverTimestamp());
          db.document("calamarMembers/"+uid).set(member);
          rights=db.document("calamarAccess/"+uid).addSnapshotListener((snapshot,error)->{
            if(request!=authGeneration)return;
            rightsReady=error==null && snapshot!=null && !snapshot.getMetadata().isFromCache();
            if(rightsReady){expires=snapshot.exists()?millis(snapshot.get("expires")):0;Long count=snapshot.getLong("screens");screens=count==null?1:Math.max(1,Math.min(10,count.intValue()));}
            changed();
          });
        }
        changed();
      });
    }
    State state(){return new State(settingsReady&&authReady&&rightsReady,required,!uid.isEmpty(),uid,expires,screens);}
    void changed(){State state=state();for(Listener listener:new ArrayList<>(listeners))listener.changed(state);}
    public Runnable watch(Listener listener){listeners.add(listener);listener.changed(state());return ()->listeners.remove(listener);}
    public void claim(String title,int count,Completion<Lease> done){
      final String account=uid,owner=holder();
      if(account.isEmpty()){done.done(null,new IllegalStateException(LOGIN));return;}
      String profile=Profiles.active()==null?"":Profiles.active().optString("name","");
      String device=(context.getResources().getConfiguration().uiMode&android.content.res.Configuration.UI_MODE_TYPE_MASK)==android.content.res.Configuration.UI_MODE_TYPE_TELEVISION?"tv":"android";
      final Lease candidate=new Lease(account,owner,title==null?"Contenido":title.substring(0,Math.min(title.length(),120)),profile.substring(0,Math.min(profile.length(),40)),device,new ArrayList<>());
      db.runTransaction(tx->{
        if(count<1||count>MAX_SCREENS)throw new IllegalStateException("Número de reproducciones no válido.");
        DocumentSnapshot access=tx.get(db.document("calamarAccess/"+account));
        long end=access.exists()?millis(access.get("expires")):0;
        if(end>0&&end<=System.currentTimeMillis())throw new IllegalStateException(EXPIRED);
        Long configured=access.getLong("screens");int limit=configured==null?1:Math.max(1,Math.min(10,configured.intValue()));
        List<DocumentReference> refs=new ArrayList<>();List<DocumentSnapshot> slots=new ArrayList<>();List<Integer> free=new ArrayList<>();
        for(int i=0;i<MAX_SCREENS;i++){DocumentReference ref=db.document("calamarStreams/"+account+"/sessions/"+i);refs.add(ref);slots.add(tx.get(ref));}
        for(int i=0;i<limit;i++)if(!slots.get(i).exists()||millis(slots.get(i).get("at"))+LEASE_MS<=System.currentTimeMillis())free.add(i);
        if(free.size()<count)throw new IllegalStateException("Se ha superado el límite de reproducciones simultáneas de tu cuenta ("+limit+" "+(limit==1?"pantalla":"pantallas")+"). Cierra la otra reproducción y vuelve a intentarlo.");
        candidate.slots.clear();candidate.slots.addAll(free.subList(0,count));
        for(int slot:candidate.slots)tx.set(refs.get(slot),payload(candidate));
        return candidate;
      }).addOnSuccessListener(lease->done.done(lease,null)).addOnFailureListener(error->done.done(null,error));
    }
    Map<String,Object> payload(Lease lease){Map<String,Object> data=new HashMap<>();data.put("holder",lease.holder);data.put("title",lease.title);data.put("profile",lease.profile);data.put("device",lease.device);data.put("at",FieldValue.serverTimestamp());return data;}
    public void beat(Lease lease,Completion<Void> done){
      db.runTransaction(tx->{
        List<DocumentReference> refs=new ArrayList<>();List<DocumentSnapshot> slots=new ArrayList<>();
        for(int slot:lease.slots){DocumentReference ref=db.document("calamarStreams/"+lease.uid+"/sessions/"+slot);refs.add(ref);slots.add(tx.get(ref));}
        for(DocumentSnapshot slot:slots)if(!slot.exists()||!lease.holder.equals(slot.getString("holder")))throw new IllegalStateException("La reserva de reproducción ha terminado.");
        for(DocumentReference ref:refs)tx.set(ref,payload(lease));return null;
      }).addOnSuccessListener(value->done.done(null,null)).addOnFailureListener(error->done.done(null,error));
    }
    public void release(Lease lease){
      db.runTransaction(tx->{
        List<DocumentReference> refs=new ArrayList<>();List<DocumentSnapshot> slots=new ArrayList<>();
        for(int slot:lease.slots){DocumentReference ref=db.document("calamarStreams/"+lease.uid+"/sessions/"+slot);refs.add(ref);slots.add(tx.get(ref));}
        for(int i=0;i<refs.size();i++)if(slots.get(i).exists()&&lease.holder.equals(slots.get(i).getString("holder")))tx.delete(refs.get(i));return null;
      });
    }
  }
}
