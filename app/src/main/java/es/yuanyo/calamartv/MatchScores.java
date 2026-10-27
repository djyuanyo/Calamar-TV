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
  static String iso(String value){return value.replaceAll("T(\\d{2}:\\d{2})Z$","T$1:00Z");}
  // Google writes many names in Spanish; ESPN uses the international ones. Both forms are kept (as on the web).
  static final String[][] SPANISH={{"club brujas","club brugge"},{"brujas","brugge"},{"napoles","napoli"},{"oporto","porto"},{"lisboa","lisbon"},
    {"sporting de portugal","sporting cp"},{"estrella roja","crvena zvezda red star"},{"turin","torino"},{"inter de milan","inter milan internazionale"},
    {"bayern de munich","bayern munich"},{"marsella","marseille"},{"olympique de lyon","lyon"},{"copenhague","copenhagen"},{"salzburgo","salzburg"},
    {"praga","prague"},{"amberes","antwerp"},{"estambul","istanbul"},{"psg","paris saint germain"},{"man city","manchester city"},
    {"man united","manchester united"},{"spurs","tottenham"},{"inglaterra","england"},{"alemania","germany"},{"francia","france"},
    {"italia","italy"},{"paises bajos","netherlands"},{"holanda","netherlands"},{"belgica","belgium"},{"suiza","switzerland"},{"suecia","sweden"},
    {"noruega","norway"},{"dinamarca","denmark"},{"croacia","croatia"},{"polonia","poland"},{"turquia","turkey turkiye"},{"grecia","greece"},
    {"gales","wales"},{"escocia","scotland"},{"irlanda","ireland"},{"rumania","romania"},{"hungria","hungary"},{"republica checa","czechia czech republic"},
    {"eslovaquia","slovakia"},{"eslovenia","slovenia"},{"ucrania","ukraine"},{"islandia","iceland"},{"finlandia","finland"},{"marruecos","morocco"},
    {"estados unidos","united states usa"},{"brasil","brazil"},{"japon","japan"},{"corea del sur","south korea"},{"arabia saudi","saudi arabia"},
    {"egipto","egypt"},{"camerun","cameroon"},{"sudafrica","south africa"},{"nueva zelanda","new zealand"},{"argelia","algeria"},{"tunez","tunisia"}};
  // Words shared by many clubs: on their own they do not identify a team.
  static final Set<String> GENERIC=new HashSet<>(Arrays.asList("fc","cf","sc","ac","cd","ud","sd","rc","afc","club","de","del","la","el","los","las","real","city","united",
    "sporting","athletic","atletico","deportivo","racing","union","olympique","borussia","inter","fk","sk","ss","as","us","ssc","sv","vfb",
    "vfl","tsg","rb","cp","sa","the","and","saint","st","san","santa","town","rovers","wanderers","county","albion","vs","contra","v"));
  static String expand(String query){String text=" "+normal(query)+" ";StringBuilder out=new StringBuilder(text);for(String[] pair:SPANISH)if(text.contains(" "+pair[0]+" "))out.append(pair[1]).append(' ');return out.toString().trim();}
  /** How well a team appears in the link's text: 1 its full name, a fraction for its distinctive words, 0 not at all. */
  static double teamScore(JSONObject team,String query){
    String text=" "+query+" ";Set<String> words=new HashSet<>(Arrays.asList(query.split(" ")));
    List<String> aliases=new ArrayList<>();for(String key:new String[]{"displayName","shortDisplayName","name","location","nickname"}){String a=normal(team.optString(key));if(!a.isEmpty())aliases.add(a);}
    for(String a:aliases)if(a.length()>=4&&text.contains(" "+a+" "))return 1;
    String abbreviation=normal(team.optString("abbreviation"));if(abbreviation.length()>=3&&words.contains(abbreviation))return 1;
    Set<String> distinctive=new LinkedHashSet<>();for(String a:aliases)for(String w:a.split(" "))if(w.length()>=3&&!GENERIC.contains(w))distinctive.add(w);
    int found=0;for(String w:distinctive)if(words.contains(w))found++;
    return distinctive.isEmpty()?0:found/(double)distinctive.size();
  }
  /**
   * The match of the link: both teams named beats one, a fuller name beats a partial one, and among equals the
   * closest to the event's date wins. The event's own teams and name are not used.
   */
  static JSONObject identify(JSONObject data,String query,String startAt)throws Exception{
    long parsed=SportsCatalog.instant(startAt),center=parsed==Long.MAX_VALUE?System.currentTimeMillis():parsed;String text=expand(query);
    JSONObject best=null;boolean bestBoth=false;double bestTotal=0;long bestDistance=Long.MAX_VALUE;
    JSONArray events=data.optJSONArray("events");
    if(events!=null)for(int i=0;i<events.length();i++){
      JSONObject e=events.getJSONObject(i);JSONArray cs=e.getJSONArray("competitions").getJSONObject(0).optJSONArray("competitors");
      if(cs==null||cs.length()!=2)continue;
      double a=teamScore(cs.getJSONObject(0).optJSONObject("team")==null?new JSONObject():cs.getJSONObject(0).getJSONObject("team"),text),b=teamScore(cs.getJSONObject(1).optJSONObject("team")==null?new JSONObject():cs.getJSONObject(1).getJSONObject("team"),text);
      if(a+b<=0)continue;
      boolean both=a>0&&b>0;long when=SportsCatalog.instant(iso(e.optString("date"))),distance=when==Long.MAX_VALUE?Long.MAX_VALUE:Math.abs(when-center);
      if(best==null||(both&&!bestBoth)||(both==bestBoth&&(a+b>bestTotal||(a+b==bestTotal&&distance<bestDistance)))){best=e;bestBoth=both;bestTotal=a+b;bestDistance=distance;}
    }
    if(best==null)throw new IOException("No se encontró este partido en los resultados de ESPN. Comprueba que el enlace sea de un partido de fútbol");
    return best.put("bothTeams",bestBoth);
  }
  static final long EVENT_GRACE_MS=5*60000L;
  static final Map<String,Long> finished=new HashMap<>();
  private static android.content.SharedPreferences storage;
  public static synchronized void initialize(android.content.Context context){
    if(storage!=null)return;
    storage=context.getApplicationContext().getSharedPreferences("match-finished-v1",android.content.Context.MODE_PRIVATE);
    for(Map.Entry<String,?> e:storage.getAll().entrySet())if(e.getKey().matches("\\d{1,20}") && e.getValue() instanceof Long)finished.put(e.getKey(),(Long)e.getValue());
  }
  static synchronized void remember(String id,Result result,long now){
    if("finished".equals(result.state))finished.put(id,result.finishedAt>0&&result.finishedAt<=now+60000?result.finishedAt:finished.containsKey(id)?finished.get(id):now);
    else finished.remove(id);
    if(storage!=null){android.content.SharedPreferences.Editor out=storage.edit().clear();for(Map.Entry<String,Long> e:finished.entrySet())out.putLong(e.getKey(),e.getValue());out.apply();}
  }
  static synchronized long deadline(String id){Long at=finished.get(id);return at==null?0:at+EVENT_GRACE_MS;}
  static boolean expired(String id,long now){long end=deadline(id);return end>0&&now>=end;}
  static boolean shouldPoll(String id,long now){return !expired(id,now)||now-deadline(id)<86400000;}
  public static class Result {
    public final String text,home,away,state; public final boolean live; public long finishedAt;
    Result(String text,String home,String away,String state){this.text=text;this.home=home;this.away=away;this.state=state;live=state.equals("live")||state.equals("halftime");}
  }
  static String score(JSONObject team){Object s=team.opt("score");return s instanceof JSONObject?((JSONObject)s).optString("displayValue"):String.valueOf(s);}
  static Result parse(JSONObject data)throws Exception{
    JSONObject e=data.optJSONObject("header");if(e==null)e=data;
    JSONObject c=e.getJSONArray("competitions").getJSONObject(0),s=c.optJSONObject("status");if(s==null)s=e.getJSONObject("status");
    JSONObject t=s.getJSONObject("type"),home=null,away=null;JSONArray teams=c.getJSONArray("competitors");
    for(int i=0;i<teams.length();i++){JSONObject a=teams.getJSONObject(i);if("home".equals(a.optString("homeAway")))home=a;if("away".equals(a.optString("homeAway")))away=a;}
    if(home==null||away==null)throw new IOException("Marcador incompleto");
    String name=t.optString("name"),state=name.contains("POSTPON")?"postponed":name.contains("CANCEL")?"cancelled":name.contains("SUSPEND")||name.contains("DELAY")||name.contains("ABANDON")?"suspended":t.optBoolean("completed")?"finished":name.equals("STATUS_HALFTIME")?"halftime":"in".equals(t.optString("state"))?"live":"scheduled";
    String label=state.equals("finished")?"Finalizado":state.equals("halftime")?"Descanso":state.equals("postponed")?"Aplazado":state.equals("cancelled")?"Cancelado":state.equals("suspended")?"Interrumpido":state.equals("scheduled")?"Programado":"En juego";
    if(state.equals("live")&&s.optString("displayClock").matches(".*[0-9].*"))label+=" · "+s.optString("displayClock").replace("'","′");
    if(Arrays.asList("live","halftime","finished","suspended").contains(state)&&score(home).matches("\\d+")&&score(away).matches("\\d+"))label=score(home)+" – "+score(away)+" · "+label;
    Result result=new Result(label,home.getJSONObject("team").optString("displayName"),away.getJSONObject("team").optString("displayName"),state);
    JSONObject meta=data.optJSONObject("meta");
    if("finished".equals(state)&&meta!=null&&"post".equals(meta.optString("gameState"))){
      long end=SportsCatalog.instant(iso(meta.optString("lastPlayWallClock"))),start=SportsCatalog.instant(iso(c.optString("date",e.optString("date"))));
      if(end!=Long.MAX_VALUE&&start!=Long.MAX_VALUE&&end>=start)result.finishedAt=end;
    }
    return result;
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
    long parsed=SportsCatalog.instant(startAt),date=parsed==Long.MAX_VALUE?System.currentTimeMillis():parsed;
    SimpleDateFormat day=new SimpleDateFormat("yyyyMMdd",Locale.ROOT);day.setTimeZone(TimeZone.getTimeZone("UTC"));
    // First the event's day; when that does not show both teams, the three days around it too.
    JSONObject e=null;
    try{e=identify(json(API+"scoreboard?dates="+day.format(new Date(date))+"&limit=1000"),query(u),startAt);}catch(Exception ignored){}
    if(e==null||!e.optBoolean("bothTeams")){
      try{e=identify(json(API+"scoreboard?dates="+day.format(new Date(date-3*86400000L))+"-"+day.format(new Date(date+3*86400000L))+"&limit=1000"),query(u),startAt);}
      catch(Exception error){if(e==null)throw error;}
    }
    return new JSONObject().put("matchUrl",value.trim()).put("matchId",e.getString("id")).put("matchDate",iso(e.getString("date")));
  }
  static final Map<String,Object[]> summaries=new HashMap<>();
  /** ESPN's whole match summary (score, events, statistics, line-ups), shared by the score and the match page. */
  public static JSONObject summary(String id)throws Exception{
    if(!id.matches("\\d{1,20}"))throw new IOException("Identificador de partido no válido");
    synchronized(summaries){Object[] c=summaries.get(id);if(c!=null&&System.currentTimeMillis()-(Long)c[0]<(expired(id,System.currentTimeMillis())?600000:30000))return (JSONObject)c[1];}
    JSONObject data=json(API+"summary?event="+id);synchronized(summaries){summaries.put(id,new Object[]{System.currentTimeMillis(),data});}return data;
  }
  static final Map<String,Object[]> boards=new HashMap<>();
  static int lookupTurn;
  /** ESPN's scoreboard of one day: every match of that day in one answer, kept 30 seconds. */
  static JSONObject board(String day)throws Exception{
    synchronized(boards){Object[] c=boards.get(day);if(c!=null&&System.currentTimeMillis()-(Long)c[0]<30000)return (JSONObject)c[1];}
    JSONObject data=json(API+"scoreboard?dates="+day+"&limit=1000");synchronized(boards){boards.put(day,new Object[]{System.currentTimeMillis(),data});}return data;
  }
  /**
   * The scores of many matches as on the web: one scoreboard per day instead of one whole summary per match
   * (ESPN cuts whoever asks for dozens of summaries every 30 seconds). Matches missing from the scoreboards
   * are asked one by one, four each round. starts: id -> kick-off (may be empty).
   */
  public static Map<String,Result> fetchAll(Map<String,String> starts){
    Map<String,Result> out=new HashMap<>();
    java.util.Set<String> days=new java.util.LinkedHashSet<>();
    for(String at:starts.values()){long t=SportsCatalog.instant(iso(at));if(t==Long.MAX_VALUE)continue;
      for(String zone:new String[]{"UTC","America/New_York"}){SimpleDateFormat f=new SimpleDateFormat("yyyyMMdd",Locale.ROOT);f.setTimeZone(TimeZone.getTimeZone(zone));days.add(f.format(new Date(t)));}}
    for(String day:days){
      try{JSONArray events=board(day).optJSONArray("events");
        for(int i=0;events!=null&&i<events.length();i++){JSONObject e=events.optJSONObject(i);if(e==null||!starts.containsKey(e.optString("id")))continue;
          try{String id=e.optString("id");Result r=parse(e);remember(id,r,System.currentTimeMillis());synchronized(cache){cache.put(id,new Cached(r));}out.put(id,r);}catch(Exception ignored){}}
      }catch(Exception ignored){}
    }
    List<String> missing=new ArrayList<>();for(String id:starts.keySet())if(!out.containsKey(id))missing.add(id);
    Collections.sort(missing);
    int n=Math.min(4,missing.size());
    for(int i=0;i<n;i++){String id=missing.get((lookupTurn+i)%missing.size());try{out.put(id,fetch(id));}catch(Exception ignored){}}
    lookupTurn=missing.isEmpty()?0:(lookupTurn+n)%missing.size();
    return out;
  }
  public static Result fetch(String id)throws Exception{
    if(!id.matches("\\d{1,20}"))throw new IOException("Identificador de partido no válido");
    synchronized(cache){Cached c=cache.get(id);if(c!=null&&System.currentTimeMillis()-c.at<(expired(id,System.currentTimeMillis())?600000:30000))return c.value;}
    Result result=parse(summary(id));remember(id,result,System.currentTimeMillis());synchronized(cache){cache.put(id,new Cached(result));}return result;
  }
}
