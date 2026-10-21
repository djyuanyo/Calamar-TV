package es.yuanyo.calamartv;

import java.net.*;
import java.io.*;
import java.text.*;
import java.util.*;
import org.json.*;

/** Google share links identify fixtures. ESPN is the source of real scores and clocks. */
public final class MatchScores {
  private MatchScores() {}
  static final String API = "https://site.api.espn.com/apis/site/v2/sports/soccer/all/";
  static final Map<String, Cached> cache = new HashMap<>();
  static class Cached { final long at=System.currentTimeMillis(); final Result value; Cached(Result v){value=v;} }
  public static URI google(String value) throws Exception {
    URI u=new URI(value.trim()); String host=u.getHost();
    if(value.length()>8192 || !"https".equals(u.getScheme()) || u.getUserInfo()!=null || u.getPort()!=-1) throw new IOException("Usa un enlace HTTPS de Google o share.google");
    if("share.google".equals(host) && u.getPath().matches("/[A-Za-z0-9_-]+"))return u;
    if(!Arrays.asList("google.com","www.google.com","google.es","www.google.es").contains(host) || !"/search".equals(u.getPath()) || query(u).isEmpty())throw new IOException("Pega el enlace del partido de Google o share.google");
    return u;
  }
  static String query(URI u) throws Exception {
    for(String part:(u.getRawQuery()==null?"":u.getRawQuery()).split("&")){String[] p=part.split("=",2);if("q".equals(p[0])&&p.length==2)return URLDecoder.decode(p[1],"UTF-8");}return "";
  }
  static String normal(String s){return Normalizer.normalize(s,Normalizer.Form.NFD).replaceAll("\\p{M}","").toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+"," ").trim();}
  static boolean mentioned(JSONObject team,String query){for(String key:new String[]{"displayName","shortDisplayName","name"}){String alias=normal(team.optString(key));if(alias.length()>=4&&(" "+query+" ").contains(" "+alias+" "))return true;}return false;}
  static String iso(String value){return value.replaceAll("T(\\d{2}:\\d{2})Z$","T$1:00Z");}
  static JSONObject identify(JSONObject data,String query,String startAt)throws Exception{
    long date=SportsCatalog.instant(startAt); if(date==Long.MAX_VALUE)throw new IOException("Indica la fecha y hora del partido");
    JSONArray found=new JSONArray(),events=data.optJSONArray("events");
    if(events!=null)for(int i=0;i<events.length();i++){
      JSONObject e=events.getJSONObject(i);JSONArray cs=e.getJSONArray("competitions").getJSONObject(0).getJSONArray("competitors");
      if(Math.abs(SportsCatalog.instant(iso(e.optString("date")))-date)<=18*3600000L && cs.length()==2 && mentioned(cs.getJSONObject(0).getJSONObject("team"),normal(query)) && mentioned(cs.getJSONObject(1).getJSONObject("team"),normal(query)))found.put(e);
    }
    if(found.length()!=1)throw new IOException(found.length()==0?"No se encontró este partido en los resultados. Comprueba el enlace y la fecha":"Hay varios partidos. Comprueba el enlace y la fecha");return found.getJSONObject(0);
  }
  public static class Result {
    public final String text,home,away,state; public final boolean live;
    Result(String text,String home,String away,String state){this.text=text;this.home=home;this.away=away;this.state=state;live=state.equals("live")||state.equals("halftime");}
  }
  static String score(JSONObject team){Object s=team.opt("score");return s instanceof JSONObject?((JSONObject)s).optString("displayValue"):String.valueOf(s);}
  static Result parse(JSONObject data)throws Exception{
    JSONObject e=data.optJSONObject("header");if(e==null)e=data;
    JSONObject c=e.getJSONArray("competitions").getJSONObject(0),s=c.optJSONObject("status");if(s==null)s=e.getJSONObject("status");
    JSONObject t=s.getJSONObject("type"),home=null,away=null;JSONArray teams=c.getJSONArray("competitors");
    for(int i=0;i<teams.length();i++){JSONObject a=teams.getJSONObject(i);if("home".equals(a.optString("homeAway")))home=a;if("away".equals(a.optString("homeAway")))away=a;}
    if(home==null||away==null)throw new IOException("Marcador incompleto");
    String name=t.optString("name"),state=t.optBoolean("completed")?"finished":name.equals("STATUS_HALFTIME")?"halftime":name.contains("POSTPON")?"postponed":name.contains("CANCEL")?"cancelled":name.contains("SUSPEND")||name.contains("DELAY")?"suspended":"in".equals(t.optString("state"))?"live":"scheduled";
    String label=state.equals("finished")?"Finalizado":state.equals("halftime")?"Descanso":state.equals("postponed")?"Aplazado":state.equals("cancelled")?"Cancelado":state.equals("suspended")?"Interrumpido":state.equals("scheduled")?"Programado":"En juego";
    if(state.equals("live")&&s.optString("displayClock").matches(".*[0-9].*"))label+=" · "+s.optString("displayClock").replace("'","′");
    if(Arrays.asList("live","halftime","finished","suspended").contains(state)&&score(home).matches("\\d+")&&score(away).matches("\\d+"))label=score(home)+" – "+score(away)+" · "+label;
    return new Result(label,home.getJSONObject("team").optString("displayName"),away.getJSONObject("team").optString("displayName"),state);
  }
  static JSONObject json(String address)throws Exception{
    HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();c.setConnectTimeout(10000);c.setReadTimeout(15000);c.setRequestProperty("Accept","application/json");
    try{if(c.getResponseCode()!=200)throw new IOException("No se pudo consultar el partido (HTTP "+c.getResponseCode()+")");try(InputStream in=c.getInputStream()){return new JSONObject(Io.read(in));}}finally{c.disconnect();}
  }
  public static JSONObject resolve(String value,String startAt)throws Exception{
    URI u=google(value);if("share.google".equals(u.getHost())){
      try{u=google(json("https://calamarmenciano.com/calamar-match.php?url="+URLEncoder.encode(value,"UTF-8")).getString("url"));}
      catch(Exception e){throw new IOException("No se pudo abrir el enlace corto. Sube calamar-match.php al hosting o usa el enlace completo de Google");}
    }
    if("share.google".equals(u.getHost()))throw new IOException("Google no ha devuelto el partido");
    long date=SportsCatalog.instant(startAt);if(date==Long.MAX_VALUE)throw new IOException("Indica primero fecha y hora");
    SimpleDateFormat day=new SimpleDateFormat("yyyyMMdd",Locale.ROOT);day.setTimeZone(TimeZone.getTimeZone("UTC"));
    JSONObject e=identify(json(API+"scoreboard?dates="+day.format(new Date(date))+"&limit=1000"),query(u),startAt);
    return new JSONObject().put("matchUrl",value.trim()).put("matchId",e.getString("id")).put("matchDate",iso(e.getString("date")));
  }
  public static Result fetch(String id)throws Exception{
    if(!id.matches("\\d{1,20}"))throw new IOException("Identificador de partido no válido");
    synchronized(cache){Cached c=cache.get(id);if(c!=null&&System.currentTimeMillis()-c.at<30000)return c.value;}
    Result result=parse(json(API+"summary?event="+id));synchronized(cache){cache.put(id,new Cached(result));}return result;
  }
}
