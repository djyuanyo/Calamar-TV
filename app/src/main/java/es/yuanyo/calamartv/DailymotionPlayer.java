package es.yuanyo.calamartv;
import java.net.URI;
import java.net.URLDecoder;
/** A Dailymotion channel uses its configured official player; never extract its temporary media URLs. */
final class DailymotionPlayer {
  static String embed(String address) {
    try {
      URI u=URI.create(address);
      if(!"https".equals(u.getScheme())||!"geo.dailymotion.com".equals(u.getHost())||u.getPort()!=-1||u.getUserInfo()!=null||u.getRawFragment()!=null
          || !u.getPath().matches("/player/[a-zA-Z0-9]{3,40}\\.html") || u.getRawQuery()==null)return null;
      for(String part:u.getRawQuery().split("&")){
        String[] pair=part.split("=",2);
        if(pair.length==2&&"video".equals(pair[0])&&URLDecoder.decode(pair[1],"UTF-8").matches("[a-zA-Z0-9]{3,80}"))return address;
      }
    }catch(Exception invalid){}
    return null;
  }
}
