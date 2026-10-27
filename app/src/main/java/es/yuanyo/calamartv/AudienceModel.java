package es.yuanyo.calamartv;

import java.text.SimpleDateFormat;
import java.util.*;

/** Firestore audience wire format, identical to web/audience.js. No user identity is recorded. */
final class AudienceModel {
  private AudienceModel() {}
  static boolean validTarget(String target){return target!=null&&target.matches("[cel]:[^|/]{1,200}");}
  /** A film or series (all its episodes): «l:<id>», as on the web. */
  static String libraryTarget(String id){String out="l:"+id;return id==null||id.isEmpty()||!validTarget(out)?null:out;}
  static String target(boolean event,String id){String out=(event?"e:":"c:")+id;return id==null||id.isEmpty()||!validTarget(out)?null:out;}
  static long minute(long now){return now/60000;}
  /** Same window as web/audience.js: viewers beat every 3 minutes, so 4 minutes back and 1 ahead count. */
  static final int FROM=-4,TO=1;
  static final long HEARTBEAT_MS=180000,COUNT_MS=120000,CARDS_MS=180000;
  static final int CARD_TARGETS=30;
  static List<String> beats(String target,long now){long m=minute(now);List<String> out=new ArrayList<>();for(long i=m+FROM;i<=m+TO;i++)out.add(target+"|"+i);return out;}
  static Map<String,Object> presence(String target,long now){Map<String,Object> data=new HashMap<>();long m=minute(now);data.put("target",target);data.put("minute",m);data.put("beat",target+"|"+m);return data;}
  static Map<String,Long> counts(List<Map<String,Object>> docs,long now){
    Map<String,Long> out=new HashMap<>();long minute=minute(now);
    for(Map<String,Object> data:docs){Object at=data.get("minute"),target=data.get("target");if(!(at instanceof Number)||!(target instanceof String)||!validTarget((String)target))continue;long m=((Number)at).longValue();if(m<minute+FROM||m>minute+TO)continue;String key=(String)target;out.put(key,out.containsKey(key)?out.get(key)+1:1L);}return out;
  }
  static String day(long now){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT);f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));return f.format(new Date(now));}
  static String visitKey(boolean event,String id){return visitKey(event?'e':'c',id);}
  /** c_ channel, e_ event, l_ film or series: the visit counter of a target («c:…», «e:…», «l:…»). */
  static String visitKey(char kind,String id){String clean=id.replaceAll("[^A-Za-z0-9_-]","_");return kind+"_"+clean.substring(0,Math.min(140,clean.length()));}
}
