package es.yuanyo.calamartv;
import android.os.Bundle;
import androidx.test.runner.AndroidJUnitRunner;
/** Playback regression tests use a local authority; access tests replace it with explicit denials/leases. */
public class CalamarTestRunner extends AndroidJUnitRunner {
  static final AccountAccess.Authority LOCAL=new AccountAccess.Authority(){
    public Runnable watch(AccountAccess.Listener listener){listener.changed(new AccountAccess.State(true,false,false,"",0,10));return ()->{};}
    public void claim(String title,int count,AccountAccess.Completion<AccountAccess.Lease> done){done.done(null,new IllegalStateException("A local anonymous fixture does not claim an account"));}
    public void beat(AccountAccess.Lease lease,AccountAccess.Completion<Void> done){done.done(null,null);}
    public void release(AccountAccess.Lease lease){}
  };
  @Override public void onCreate(Bundle args){AccountAccess.factory=context->LOCAL;super.onCreate(args);}
}
