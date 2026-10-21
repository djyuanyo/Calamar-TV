package es.yuanyo.calamartv;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.firestore.*;
import java.util.*;

/** A playback session shared with web spectators and the existing admin statistics. */
final class AudienceSession {
  interface Count { void update(long viewers); }
  private final Handler handler=new Handler(Looper.getMainLooper());
  private final FirebaseFirestore db;
  private final DocumentReference presence;
  private final String target, channelId;
  private final Count count;
  private Task<Void> writes=Tasks.forResult(null);
  private boolean opened,playing,visited,counting;
  private int generation;
  private final Runnable heartbeat=new Runnable(){public void run(){if(!opened)return;if(playing)writePresence();handler.postDelayed(this,60000);}};
  private final Runnable refresh=new Runnable(){public void run(){if(!opened)return;readCount();handler.postDelayed(this,30000);}};

  AudienceSession(Context context,String target,String channelId,Count count){
    this.target=AudienceModel.validTarget(target)?target:null;this.channelId=channelId;this.count=count;
    db=FirebaseFirestore.getInstance(SharedCatalog.app(context));
    String session=UUID.randomUUID().toString().replace("-","");
    presence=db.collection("calamarAudience").document(session);
  }
  void open(){if(opened||target==null)return;opened=true;generation++;handler.post(refresh);handler.post(heartbeat);}
  void watching(boolean value){
    if(!opened||target==null||playing==value)return;
    playing=value;
    if(value){writePresence();if(!visited){visited=true;recordVisits();}}
    else removePresence();
  }
  private void writePresence(){
    writes=writes.continueWithTask(ignored -> {
      if(!opened||!playing)return presence.delete();
      Map<String,Object> data=AudienceModel.presence(target,System.currentTimeMillis());data.put("updatedAt",FieldValue.serverTimestamp());return presence.set(data);
    });
    writes.addOnCompleteListener(done -> {if(opened)readCount();});
  }
  private void removePresence(){writes=writes.continueWithTask(ignored -> presence.delete());writes.addOnCompleteListener(done -> {if(opened)readCount();});}
  private void readCount(){
    if(counting||!opened)return;counting=true;final int version=generation;
    db.collection("calamarAudience").whereIn("beat",AudienceModel.beats(target,System.currentTimeMillis())).count().get(AggregateSource.SERVER)
      .addOnCompleteListener(task -> {counting=false;if(!opened||version!=generation)return;count.update(task.isSuccessful()?task.getResult().getCount():-1);});
  }
  private void recordVisits(){
    final String day=AudienceModel.day(System.currentTimeMillis());boolean event=target.startsWith("e:");
    List<String> keys=new ArrayList<>();keys.add(AudienceModel.visitKey(event,target.substring(2)));
    if(event&&channelId!=null&&!channelId.isEmpty())keys.add(AudienceModel.visitKey(false,channelId));
    Task<Void> queue=Tasks.forResult(null);
    for(String key:keys)queue=queue.continueWithTask(ignored -> {
      Map<String,Object> data=new HashMap<>();data.put("last",key);data.put(key,FieldValue.increment(1));return db.collection("calamarVisits").document(day).set(data,SetOptions.merge());
    });
  }
  void close(){opened=false;playing=false;generation++;handler.removeCallbacksAndMessages(null);if(target!=null)removePresence();}
}
