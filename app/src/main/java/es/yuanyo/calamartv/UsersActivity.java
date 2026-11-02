package es.yuanyo.calamartv;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Typeface;
import android.view.View;
import android.widget.*;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.firestore.*;
import com.google.firebase.Timestamp;
import java.util.*;
import org.json.*;

/** Administrator-only directory and admission settings, shared with the web administration. */
public final class UsersActivity extends Activity {
  private FirebaseFirestore db;
  private LinearLayout rows;
  private TextView status, policyStatus, pagination;
  private EditText search;
  private Switch required;
  private Button reload, previous, next;
  private boolean loadingPolicy = true;
  private int page;
  private final List<Map<String,Object>> users = new ArrayList<>();
  private final FirebaseAuth.AuthStateListener authListener = auth -> { if (!SharedCatalog.administrator(auth.getCurrentUser())) finish(); };
  @Override protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    if (!SharedCatalog.administrator(SharedCatalog.auth(this).getCurrentUser())) { finish(); return; }
    db = FirebaseFirestore.getInstance(SharedCatalog.app(this));
    ScrollView scroll = new ScrollView(this); LinearLayout body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(dp(20),dp(20),dp(20),dp(24)); body.setBackgroundColor(Ui.BG); scroll.addView(body); setContentView(scroll);
    Button back = button("‹ Administración", this::finish); body.addView(back);
    TextView heading = text("Usuarios y acceso web",24); heading.setTypeface(null,Typeface.BOLD); body.addView(heading);
    required = new Switch(this); required.setText("Exigir una cuenta para entrar en la web"); required.setTextColor(Ui.FG); required.setEnabled(false); required.setPadding(0,dp(16),0,dp(12)); body.addView(required);
    policyStatus = text("Cargando configuración…",14); body.addView(policyStatus);
    required.setOnCheckedChangeListener((v,on) -> { if (loadingPolicy) return; required.setEnabled(false); Map<String,Object> data = new HashMap<>(); data.put("requireLogin",on); data.put("updatedAt",FieldValue.serverTimestamp());
      db.document("calamarWeb/access").set(data).addOnSuccessListener(ok -> { if (isFinishing()) return; required.setEnabled(true); policyStatus.setText(on ? "Guardado: inicio de sesión obligatorio en la web." : "Guardado: la web permite entrar sin cuenta."); }).addOnFailureListener(error -> { if (isFinishing()) return; loadingPolicy=true; required.setChecked(!on); loadingPolicy=false; required.setEnabled(true); policyStatus.setText("No se pudo guardar el acceso web. Comprueba los permisos de Firebase."); }); });
    db.document("calamarWeb/access").get(Source.SERVER).addOnSuccessListener(s -> { if (isFinishing()) return; required.setChecked(!s.exists() || !Boolean.FALSE.equals(s.get("requireLogin"))); loadingPolicy=false; required.setEnabled(true); policyStatus.setText("Este interruptor solo cambia el acceso a la web; Android mantiene su acceso actual."); }).addOnFailureListener(e -> policyStatus.setText("No se pudo leer la configuración de acceso."));
    search = new EditText(this); search.setSingleLine(true); search.setHint("Buscar por nombre o correo"); search.setContentDescription("Buscar usuarios"); search.setTextColor(Ui.FG); search.setHintTextColor(Ui.MUTED); body.addView(search);
    reload = button("Actualizar usuarios",this::load); body.addView(reload); status = text("Cargando usuarios…",14); body.addView(status); rows = new LinearLayout(this); rows.setOrientation(LinearLayout.VERTICAL); body.addView(rows);
    LinearLayout controls = new LinearLayout(this); previous=button("Anterior",()->{page--;draw();}); next=button("Siguiente",()->{page++;draw();}); pagination=text("",14); controls.addView(previous); controls.addView(pagination); controls.addView(next); body.addView(controls);
    search.addTextChangedListener(new android.text.TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){} public void onTextChanged(CharSequence s,int start,int before,int count){page=0;draw();} public void afterTextChanged(android.text.Editable e){}});
    load();
  }
  private void load() {
    reload.setEnabled(false); status.setText("Cargando usuarios…");
    Tasks.whenAllSuccess(db.collection("calamarMembers").get(Source.SERVER), db.collection("calamarUsers").get(Source.SERVER), db.collection("calamarUserAccess").get(Source.SERVER)).addOnSuccessListener(results -> {
      if (isFinishing() || isDestroyed()) return;
      Map<String,Map<String,Object>> found = new LinkedHashMap<>();
      for (DocumentSnapshot s : ((QuerySnapshot)results.get(1)).getDocuments()) {
        Map<String,Object> row = new HashMap<>(); row.put("uid",s.getId());
        try { JSONArray profiles = new JSONObject(s.getString("json")).optJSONArray("profiles"); row.put("profileCount",profiles==null?0:profiles.length()); if(profiles!=null&&profiles.optJSONObject(0)!=null)row.put("name",profiles.getJSONObject(0).optString("name")); } catch(Exception ignored){}
        found.put(s.getId(),row);
      }
      for(DocumentSnapshot s:((QuerySnapshot)results.get(0)).getDocuments()){Map<String,Object> row=found.computeIfAbsent(s.getId(),id->new HashMap<>());row.putAll(s.getData());row.put("uid",s.getId());}
      for(DocumentSnapshot s:((QuerySnapshot)results.get(2)).getDocuments()){Map<String,Object> row=found.computeIfAbsent(s.getId(),id->new HashMap<>());row.put("uid",s.getId());row.put("blocked",Boolean.TRUE.equals(s.get("blocked")));}
      users.clear(); users.addAll(found.values()); users.sort((a,b)->label(a).compareToIgnoreCase(label(b))); reload.setEnabled(true); draw();
    }).addOnFailureListener(e->{if(isFinishing())return;reload.setEnabled(true);status.setText("No se pudieron cargar los usuarios. Comprueba los permisos de Firebase.");});
  }
  private void draw() {
    if (!SharedCatalog.administrator(SharedCatalog.auth(this).getCurrentUser())) { finish(); return; }
    rows.removeAllViews(); String query=MultiEventPicker.normalize(search.getText().toString()); List<Map<String,Object>> found=new ArrayList<>();
    for(Map<String,Object> u:users)if(MultiEventPicker.normalize(label(u)+" "+u.getOrDefault("email","")).contains(query))found.add(u);
    int count=30; page=Math.max(0,Math.min(page,(found.size()-1)/count)); status.setText(found.size()+" usuarios"); pagination.setText("  "+(page+1)+" / "+Math.max(1,(int)Math.ceil(found.size()/(double)count))+"  "); previous.setEnabled(page>0);next.setEnabled((page+1)*count<found.size());
    for(int i=page*count;i<Math.min(found.size(),(page+1)*count);i++){
      Map<String,Object> user=found.get(i);String uid=String.valueOf(user.get("uid"));boolean self=uid.equals(SharedCatalog.auth(this).getCurrentUser().getUid()),blocked=Boolean.TRUE.equals(user.get("blocked"));
      LinearLayout card=new LinearLayout(this);card.setOrientation(LinearLayout.VERTICAL);card.setPadding(dp(16),dp(16),dp(16),dp(16));card.setBackground(Ui.shape(this,Ui.SURFACE,12,1,0x30ffffff));LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(-1,-2);cp.bottomMargin=dp(12);rows.addView(card,cp);
      TextView name=text(label(user)+(self?" · Administrador":blocked?" · Bloqueado en la web":""),18);name.setTypeface(null,Typeface.BOLD);card.addView(name);card.addView(text(String.valueOf(user.getOrDefault("email","El correo se actualizará cuando vuelva a iniciar sesión.")),14));card.addView(text("Registro: "+date(user.get("registeredAt"))+"\nÚltimo acceso: "+date(user.get("lastSeen"))+"\nPerfiles: "+user.getOrDefault("profileCount",0),14));
      Button action=button(self?"Tu cuenta":blocked?"Desbloquear":"Bloquear en la web",null);action.setEnabled(!self);action.setOnClickListener(v->{action.setEnabled(false);Map<String,Object> data=new HashMap<>();data.put("blocked",!blocked);data.put("updatedAt",FieldValue.serverTimestamp());db.document("calamarUserAccess/"+uid).set(data).addOnSuccessListener(ok->{if(isFinishing())return;user.put("blocked",!blocked);draw();}).addOnFailureListener(e->{if(isFinishing())return;action.setEnabled(true);status.setText("No se pudo cambiar el acceso de esta cuenta.");});});card.addView(action);
    }
    if(found.isEmpty())rows.addView(text("No hay usuarios con ese nombre o correo.",16));
  }
  private static String label(Map<String,Object> row){String name=String.valueOf(row.getOrDefault("name",""));return !name.isEmpty()?name:String.valueOf(row.getOrDefault("email","Usuario"));}
  private static String date(Object value){if(!(value instanceof Timestamp))return "Sin datos todavía";java.text.SimpleDateFormat format=new java.text.SimpleDateFormat("dd/MM/yy HH:mm",new Locale("es","ES"));format.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));return format.format(((Timestamp)value).toDate());}
  private int dp(int n){return Ui.dp(this,n);}
  private TextView text(String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextColor(Ui.FG);t.setTextSize(size);t.setPadding(0,dp(6),0,dp(6));return t;}
  private Button button(String title,Runnable action){Button b=Ui.pill(this,title,Ui.Kind.SURFACE,true);b.setOnClickListener(v->{if(action!=null)action.run();});return b;}
  @Override protected void onStart(){super.onStart();SharedCatalog.auth(this).addAuthStateListener(authListener);}
  @Override protected void onStop(){SharedCatalog.auth(this).removeAuthStateListener(authListener);super.onStop();}
}
