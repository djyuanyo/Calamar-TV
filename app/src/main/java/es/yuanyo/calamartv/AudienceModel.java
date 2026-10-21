package es.yuanyo.calamartv;

import java.text.SimpleDateFormat;
import java.util.*;

/** Firestore audience wire format, identical to web/audience.js. No user identity is recorded. */
final class AudienceModel {
  private AudienceModel() {}
  static boolean validTarget(String target){return target!=null&&target.matches("[ce]:[^|/]{1,200}");}
  static String target(boolean event,String id){String out=(event?"e:":"c:")+id;return id==null||id.isEmpty()||!validTarget(out)?null:out;}
  static long minute(long now){return now/60000;}
  static List<String> beats(String target,long now){long m=minute(now);return Arrays.asList(target+"|"+(m-2),target+"|"+(m-1),target+"|"+m,target+"|"+(m+1));}
  static Map<String,Object> presence(String target,long now){Map<String,Object> data=new HashMap<>();long m=minute(now);data.put("target",target);data.put("minute",m);data.put("beat",target+"|"+m);return data;}
  static Map<String,Long> counts(List<Map<String,Object>> docs,long now){
    Map<String,Long> out=new HashMap<>();long minute=minute(now);
    for(Map<String,Object> data:docs){Object at=data.get("minute"),target=data.get("target");if(!(at instanceof Number)||!(target instanceof String)||!validTarget((String)target))continue;long m=((Number)at).longValue();if(m<minute-2||m>minute+1)continue;String key=(String)target;out.put(key,out.containsKey(key)?out.get(key)+1:1L);}return out;
  }
  static String day(long now){SimpleDateFormat f=new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT);f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));return f.format(new Date(now));}
  static String visitKey(boolean event,String id){String clean=id.replaceAll("[^A-Za-z0-9_-]","_");return (event?"e_":"c_")+clean.substring(0,Math.min(140,clean.length()));}
}
