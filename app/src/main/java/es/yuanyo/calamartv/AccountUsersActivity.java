package es.yuanyo.calamartv;

import android.app.*;
import android.os.Bundle;
import android.text.*;
import android.view.View;
import android.widget.*;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.Timestamp;
import com.google.firebase.firestore.*;
import java.text.SimpleDateFormat;
import java.util.*;

/** The same account dates, screen limits and registration switch as Administración → Usuarios on web. */
public class AccountUsersActivity extends Activity {
  private FirebaseFirestore db;
  private LinearLayout rows;
  private TextView note;
  private EditText search;
  private CheckBox required;
  private boolean painting;
  private ListenerRegistration settings;
  private final List<Map<String,Object>> users=new ArrayList<>();
  @Override public void onCreate(Bundle state){
    super.onCreate(state);
    if(!SharedCatalog.administrator(Profiles.user(this))){Toast.makeText(this,"Entra con la cuenta de administración.",Toast.LENGTH_LONG).show();finish();return;}
    db=AccountAccess.database(this);
    ScrollView scroll=new ScrollView(this);LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(20,20,20,20);body.setBackgroundColor(Ui.BG);scroll.addView(body);setContentView(scroll);
    Button back=new Button(this);back.setText("Volver");back.setOnClickListener(v->finish());body.addView(back);
    body.addView(text("Usuarios y acceso",24));
    required=new CheckBox(this);required.setText("Exigir registro para ver contenido");required.setTextColor(Ui.FG);body.addView(required);
    note=text("Cargando…",15);body.addView(note);
    body.addView(text("Sin fecha, el acceso es indefinido. La caducidad se aplica al comenzar el día seleccionado en España. El límite de pantallas se comparte entre todos los perfiles.",15));
    search=new EditText(this);search.setHint("Buscar por email o nombre");search.setTextColor(Ui.FG);search.setHintTextColor(Ui.MUTED);body.addView(search);
    Button refresh=new Button(this);refresh.setText("Actualizar usuarios");refresh.setOnClickListener(v->load());body.addView(refresh);
    rows=new LinearLayout(this);rows.setOrientation(LinearLayout.VERTICAL);body.addView(rows);
    search.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){} public void onTextChanged(CharSequence s,int a,int b,int c){draw();}public void afterTextChanged(Editable e){}});
    settings=db.document("calamarSettings/access").addSnapshotListener((snapshot,error)->{
      if(error!=null){note.setText("No se pudo leer el ajuste de acceso.");return;}
      painting=true;required.setChecked(snapshot==null||!snapshot.exists()||!Boolean.FALSE.equals(snapshot.getBoolean("requireRegistration")));painting=false;
    });
    required.setOnCheckedChangeListener((button,checked)->{
      if(painting)return;
      Map<String,Object> value=new HashMap<>();value.put("requireRegistration",checked);value.put("updatedAt",FieldValue.serverTimestamp());required.setEnabled(false);
      db.document("calamarSettings/access").set(value).addOnSuccessListener(v->{note.setText("Guardado para la web, Android y Android TV.");required.setEnabled(true);})
          .addOnFailureListener(error->{note.setText("No se pudo guardar el ajuste.");painting=true;required.setChecked(!checked);painting=false;required.setEnabled(true);});
    });
    load();
  }
  private TextView text(String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextColor(Ui.FG);t.setTextSize(size);t.setPadding(0,8,0,8);return t;}
  private static long time(Object value){return value instanceof Timestamp?((Timestamp)value).toDate().getTime():0;}
  private static String date(long value){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT);f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));return f.format(new Date(value));}
  private void load(){
    note.setText("Cargando usuarios…");
    Tasks.whenAllSuccess(db.collection("calamarMembers").get(Source.SERVER),db.collection("calamarAccess").get(Source.SERVER),db.collectionGroup("sessions").get(Source.SERVER)).addOnSuccessListener(result->{
      if(isFinishing())return;
      Map<String,Map<String,Object>> rights=new HashMap<>();for(DocumentSnapshot d:((QuerySnapshot)result.get(1)).getDocuments())rights.put(d.getId(),d.getData());
      Map<String,Integer> live=new HashMap<>();for(DocumentSnapshot d:((QuerySnapshot)result.get(2)).getDocuments())if(time(d.get("at"))+AccountAccess.LEASE_MS>System.currentTimeMillis()){
        DocumentReference account=d.getReference().getParent().getParent();if(account!=null&&"calamarStreams".equals(account.getParent().getId()))live.put(account.getId(),live.getOrDefault(account.getId(),0)+1);
      }
      users.clear();for(DocumentSnapshot d:((QuerySnapshot)result.get(0)).getDocuments()){
        Map<String,Object> user=new HashMap<>(d.getData());user.put("uid",d.getId());if(rights.containsKey(d.getId()))user.putAll(rights.get(d.getId()));user.put("live",live.getOrDefault(d.getId(),0));users.add(user);
      }
      users.sort((a,b)->Long.compare(time(b.get("seenAt")),time(a.get("seenAt"))));note.setText(users.size()+" usuarios");draw();
    }).addOnFailureListener(error->note.setText("No se pudo cargar la lista. Comprueba los permisos de Firebase y la conexión."));
  }
  private void draw(){
    if(rows==null)return;rows.removeAllViews();String q=search.getText().toString().trim().toLowerCase(Locale.ROOT);
    for(Map<String,Object> user:users){
      String name=String.valueOf(user.getOrDefault("name","")),email=String.valueOf(user.getOrDefault("email",""));
      if(!(name+" "+email).toLowerCase(Locale.ROOT).contains(q))continue;
      long expires=time(user.get("expires"));Object count=user.getOrDefault("screens",1);
      rows.addView(text((name.isEmpty()?email:name)+"\n"+email+"\n"+(expires>0?"Caduca: "+date(expires):"Sin caducidad")+" · Pantallas: "+count+" · Viendo ahora: "+user.get("live"),16));
      Button edit=new Button(this);edit.setText("Editar acceso");edit.setOnClickListener(v->edit(user));rows.addView(edit);
    }
    if(users.isEmpty())rows.addView(text("Los usuarios aparecerán al entrar con su cuenta en la web o en la app actualizada.",15));
  }
  private void edit(Map<String,Object> user){
    LinearLayout form=new LinearLayout(this);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(24,12,24,12);
    long previous=time(user.get("expires"));final String[] selected={previous>0?date(previous):""};
    Button day=new Button(this);day.setText(selected[0].isEmpty()?"Sin fecha de caducidad":selected[0]);form.addView(day);
    day.setOnClickListener(v->{Calendar c=Calendar.getInstance(TimeZone.getTimeZone("Europe/Madrid"));if(previous>0)c.setTimeInMillis(previous);
      new DatePickerDialog(this,(picker,y,m,d)->{selected[0]=String.format(Locale.ROOT,"%04d-%02d-%02d",y,m+1,d);day.setText(selected[0]);},c.get(Calendar.YEAR),c.get(Calendar.MONTH),c.get(Calendar.DAY_OF_MONTH)).show();});
    Button clear=new Button(this);clear.setText("Sin fecha");clear.setOnClickListener(v->{selected[0]="";day.setText("Sin fecha de caducidad");});form.addView(clear);
    EditText screens=new EditText(this);screens.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);screens.setHint("Pantallas simultáneas (1–10)");screens.setText(String.valueOf(user.getOrDefault("screens",1)));form.addView(screens);
    AlertDialog dialog=new AlertDialog.Builder(this).setTitle(String.valueOf(user.get("email"))).setView(form).setPositiveButton("Guardar",null).setNegativeButton("Cancelar",null).create();
    dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{try{
      int limit=Integer.parseInt(screens.getText().toString());if(limit<1||limit>10)throw new IllegalArgumentException("Las pantallas van de 1 a 10.");
      Timestamp expires=null;if(!selected[0].isEmpty()){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT);f.setLenient(false);f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));expires=new Timestamp(f.parse(selected[0]));}
      Map<String,Object> value=new HashMap<>();value.put("expires",expires);value.put("screens",limit);value.put("updatedAt",FieldValue.serverTimestamp());dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
      db.document("calamarAccess/"+user.get("uid")).set(value).addOnSuccessListener(done->{dialog.dismiss();load();}).addOnFailureListener(error->{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);Toast.makeText(this,"No se pudo guardar.",Toast.LENGTH_LONG).show();});
    }catch(Exception error){screens.setError(error.getMessage());}}));dialog.show();
  }
  @Override protected void onDestroy(){if(settings!=null)settings.remove();super.onDestroy();}
}
