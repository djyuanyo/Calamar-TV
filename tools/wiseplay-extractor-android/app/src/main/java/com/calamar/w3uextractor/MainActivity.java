package com.calamar.w3uextractor;

import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class MainActivity extends Activity {
  EditText input; Button start, exportTxt, exportCsv, exportErrors; TextView status; LinearLayout root;
  final List<String[]> rows = Collections.synchronizedList(new ArrayList<>());
  final List<String> errors = Collections.synchronizedList(new ArrayList<>());
  final HashSet<String> visited = new HashSet<>();
  volatile boolean running=false; static final int MAX_FILES=1200, MAX_DEPTH=10; static final String DEFAULT="https://af1c1onados.vercel.app/af1cionados.w3u";
  public void onCreate(Bundle b){super.onCreate(b); ScrollView scroll=new ScrollView(this); root=new LinearLayout(this);root.setOrientation(1);root.setPadding(24,32,24,24);root.setBackgroundColor(Color.rgb(250,250,252));scroll.addView(root);
    TextView title=new TextView(this); title.setText("Extractor Wiseplay");title.setTextSize(26);title.setTextColor(0xff102446);title.setTypeface(null,1);root.addView(title);
    TextView hint=new TextView(this);hint.setText("Extrae canales, enlaces y sublistas W3U / M3U. Guarda los resultados en TXT o CSV.");hint.setTextSize(15);hint.setPadding(0,12,0,18);root.addView(hint);
    input=new EditText(this);input.setSingleLine(false);input.setText(DEFAULT);input.setTextSize(14);input.setHint("URL https://...w3u");root.addView(input);
    start=button("Extraer enlaces");start.setOnClickListener(v->extract());
    status=new TextView(this);status.setText("Listo para iniciar.");status.setTextSize(16);status.setPadding(0,22,0,22);root.addView(status);
    exportTxt=button("Guardar TXT");exportTxt.setOnClickListener(v->save(1));exportCsv=button("Guardar CSV");exportCsv.setOnClickListener(v->save(2));exportErrors=button("Guardar errores TXT");exportErrors.setOnClickListener(v->save(3));enableExport(false);setContentView(scroll);
  }
  Button button(String text){Button b=new Button(this);b.setText(text);root.addView(b);return b;}
  void enableExport(boolean enabled){exportTxt.setEnabled(enabled);exportCsv.setEnabled(enabled);exportErrors.setEnabled(enabled);}
  void display(String s){runOnUiThread(()->status.setText(s));}
  static class Task {String url,cat;int depth;Task(String u,String c,int d){url=u;cat=c;depth=d;}}
  void extract(){if(running)return;String src=input.getText().toString().trim();if(!src.startsWith("https://")){status.setText("Introduce una URL HTTPS válida.");return;}rows.clear();errors.clear();visited.clear();enableExport(false);running=true;start.setEnabled(false);
    new Thread(()->{ArrayDeque<Task> q=new ArrayDeque<>();q.add(new Task(src,"Lista principal",0));while(!q.isEmpty() && visited.size()<MAX_FILES){Task t=q.removeFirst();if(!visited.add(t.url))continue;try{String body=fetch(t.url);if(body.trim().startsWith("#EXTM3U")){parseM3U(body,t);continue;}JSONObject j=new JSONObject(body);parseStations(j.optJSONArray("stations"),t.cat,t.url);parseGroups(j.optJSONArray("groups"),t.cat,t.url,t.depth,q);}
      catch(Exception ex){errors.add(t.url+" — "+ex.getClass().getSimpleName()+": "+ex.getMessage());}
      if(visited.size()%4==0) display("Listas consultadas: "+visited.size()+"\nEntradas: "+rows.size()+"\nErrores: "+errors.size());
    }
    if(!q.isEmpty())errors.add("Se alcanzó el límite de "+MAX_FILES+" sublistas.");running=false;
    runOnUiThread(()->{status.setText("Extracción finalizada\nListas: "+visited.size()+"\nEntradas: "+rows.size()+"\nIncidencias: "+errors.size());start.setEnabled(true);enableExport(true);});
  }).start();}
  String fetch(String u)throws Exception{URL url=new URL(u);if(!url.getProtocol().equals("https"))throw new IOException("Solo HTTPS");HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setConnectTimeout(12000);c.setReadTimeout(18000);c.setRequestProperty("User-Agent","Mozilla/5.0 WiseplayExtractor/1.0");c.setInstanceFollowRedirects(true);int status=c.getResponseCode();if(status>=400)throw new IOException("HTTP "+status);if(!c.getURL().getProtocol().equals("https"))throw new IOException("Redirección no segura");try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buf=new byte[8192];int n,total=0;while((n=in.read(buf))!=-1){total+=n;if(total>8_000_000)throw new IOException("Sublista demasiado grande");out.write(buf,0,n);}return out.toString("UTF-8");}finally{c.disconnect();}}
  String abs(String base,String link){try{return new URI(base).resolve(link).toString();}catch(Exception ex){return link;}}
  void add(String cat,String name,String url,String kind){if(url!=null&&!url.trim().isEmpty())rows.add(new String[]{cat,name==null?"Sin nombre":name,url,kind});}
  void parseStations(JSONArray a,String cat,String base){if(a==null)return;for(int i=0;i<a.length();i++){JSONObject s=a.optJSONObject(i);if(s==null)continue;for(String u:urls(s.opt("url")))add(cat,s.optString("name","Sin nombre"),abs(base,u),"reproducción");}}
  void parseGroups(JSONArray a,String cat,String base,int depth,ArrayDeque<Task>q){if(a==null)return;for(int i=0;i<a.length();i++){JSONObject g=a.optJSONObject(i);if(g==null)continue;String name=g.optString("name","Grupo");String sub=cat+" / "+name;parseStations(g.optJSONArray("stations"),sub,base);parseGroups(g.optJSONArray("groups"),sub,base,depth,q);for(String link:urls(g.opt("url"))){String u=abs(base,link),path=u.toLowerCase(Locale.ROOT).split("\\?")[0];if(path.endsWith(".w3u")||path.endsWith(".json")||path.endsWith(".m3u")){add(cat,name,u,"sublista");if(depth<MAX_DEPTH)q.addLast(new Task(u,sub,depth+1));else errors.add("Profundidad máxima: "+u);}else add(cat,name,u,"reproducción/página");}}}
  List<String> urls(Object obj){List<String> a=new ArrayList<>();if(obj instanceof String)a.add((String)obj);if(obj instanceof JSONArray){JSONArray ar=(JSONArray)obj;for(int i=0;i<ar.length();i++)if(ar.opt(i) instanceof String)a.add(ar.optString(i));}return a;}
  void parseM3U(String body,Task t){String name="Sin nombre";for(String line:body.split("\\r?\\n")){line=line.trim();if(line.startsWith("#EXTINF:")){int k=line.lastIndexOf(',');name=k>=0?line.substring(k+1).trim():"Sin nombre";}else if(!line.isEmpty()&&!line.startsWith("#")){add(t.cat,name,abs(t.url,line),"reproducción");name="Sin nombre";}}}
  void save(int type){if(running)return;Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(type==2?"text/csv":"text/plain");i.putExtra(Intent.EXTRA_TITLE,type==1?"enlaces_wiseplay.txt":type==2?"enlaces_wiseplay.csv":"errores_wiseplay.txt");startActivityForResult(i,type);}
  protected void onActivityResult(int req,int result,Intent data){super.onActivityResult(req,result,data);if(result!=RESULT_OK||data==null||data.getData()==null)return;try(OutputStream o=getContentResolver().openOutputStream(data.getData());OutputStreamWriter w=new OutputStreamWriter(o,StandardCharsets.UTF_8)){if(req==3){for(String e:errors){w.write(e);w.write("\n");}}else{if(req==2)w.write("Categoría,Nombre,Enlace,Tipo\n");for(String[] r:rows){if(req==1)w.write(r[0]+" | "+r[1]+" | "+r[2]+" | "+r[3]+"\n");else w.write(csv(r[0])+","+csv(r[1])+","+csv(r[2])+","+csv(r[3])+"\n");}}Toast.makeText(this,"Archivo guardado",Toast.LENGTH_LONG).show();}catch(Exception ex){Toast.makeText(this,"Error al guardar: "+ex.getMessage(),Toast.LENGTH_LONG).show();}}
  String csv(String s){return "\""+s.replace("\"","\"\"")+"\"";}
}
