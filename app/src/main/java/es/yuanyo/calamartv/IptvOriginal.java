package es.yuanyo.calamartv;

import android.content.Context;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseUser;
import java.net.URI;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONObject;

/** Resolves an IONOS playlist to its original signal over the authenticated API. Media plays directly. */
final class IptvOriginal {
  private IptvOriginal() {}

  private static final String BASE = "https://video.calamarmenciano.com/iptv-hls/";
  private static final Pattern LINK = Pattern.compile(Pattern.quote(BASE) + "([a-f0-9]{32})/index\\.m3u8");
  private static final OkHttpClient CLIENT = new OkHttpClient.Builder().followRedirects(false)
      .followSslRedirects(false).callTimeout(5, TimeUnit.SECONDS).build();

  static String key(String source) {
    Matcher match = LINK.matcher(source == null ? "" : source);
    return match.matches() ? match.group(1) : null;
  }

  /** Called on a playback worker. A guest or an unavailable lookup can still use the HLS playlist. */
  static String find(Context context, String source) {
    String key = key(source);
    if (key == null) return null;
    FirebaseUser user = Profiles.user(context);
    if (user == null || user.isAnonymous()) return null;
    try {
      String token = Tasks.await(user.getIdToken(false), 4, TimeUnit.SECONDS).getToken();
      if (token == null) return null;
      Request request = new Request.Builder().url(BASE + "original")
          .header("Authorization", "Bearer " + token)
          .post(RequestBody.create(new JSONObject().put("key", key).toString(), MediaType.get("application/json")))
          .build();
      try (Response response = CLIENT.newCall(request).execute()) {
        if (!response.isSuccessful() || response.body() == null) return null;
        String address = new JSONObject(response.body().string()).optString("url");
        return playableSignal(address) ? address : null;
      }
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
    } catch (Exception unavailable) { /* Never log original IPTV addresses or identity tokens. */ }
    return null;
  }

  static boolean playableSignal(String address) {
    if (CastSource.needsBridge(address)) return true;
    try {
      URI uri = URI.create(address);
      return "https".equals(uri.getScheme()) && uri.getHost() != null && uri.getUserInfo() == null
          && uri.getRawFragment() == null && !UserChannels.isPage(address);
    } catch (IllegalArgumentException invalid) { return false; }
  }
}
