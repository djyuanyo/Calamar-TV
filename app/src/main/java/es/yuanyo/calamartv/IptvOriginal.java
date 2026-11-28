package es.yuanyo.calamartv;

import android.content.Context;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.auth.FirebaseUser;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
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
  private static final String BUNNY = "https://calamartv.b-cdn.net/iptv-hls/";
  private static final String HOSTING = "https://calamarmenciano.com/calamar-tv-relay.php";
  private static final String OVERFLOW = HOSTING + "?stream=1&backup=";
  private static final String PILOT_FINGERPRINT = "c81ed917604c0f1a8e1a77ccac8fbb1763dab796eebf7f374ac6ab31852f3256";
  private static final Pattern LINK = Pattern.compile(Pattern.quote(BASE) + "([a-f0-9]{32})/index\\.m3u8");
  private static final OkHttpClient CLIENT = new OkHttpClient.Builder().followRedirects(false)
      .followSslRedirects(false).callTimeout(5, TimeUnit.SECONDS).build();
  private static final OkHttpClient ADMISSION = CLIENT.newBuilder().callTimeout(1400, TimeUnit.MILLISECONDS).build();

  static String key(String source) {
    Matcher match = LINK.matcher(source == null ? "" : source);
    return match.matches() ? match.group(1) : null;
  }

  /** The fingerprint limits playback to the configured Bunny pilot. */
  static String pilotCdn(String source) {
    String key = key(source);
    if (key == null) return null;
    try {
      byte[] hash = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
      StringBuilder fingerprint = new StringBuilder(hash.length * 2);
      for (byte value : hash) {
        fingerprint.append(Character.forDigit((value & 0xff) >>> 4, 16));
        fingerprint.append(Character.forDigit(value & 0xf, 16));
      }
      return PILOT_FINGERPRINT.contentEquals(fingerprint) ? BUNNY + key + "/index.m3u8" : null;
    } catch (NoSuchAlgorithmException unavailable) { return null; }
  }

  static boolean preferOriginal(String source) {
    return key(source) != null && pilotCdn(source) == null;
  }

  static String overflowKey(String source) {
    if (source == null || !source.startsWith(BUNNY)) return key(source);
    String primary = BASE + source.substring(BUNNY.length());
    return source.equals(pilotCdn(primary)) ? key(primary) : null;
  }

  static boolean isOverflow(String source) {
    return source != null && source.startsWith(OVERFLOW) && source.substring(OVERFLOW.length()).matches("[a-f0-9]{32}");
  }

  static String overflow(String source) {
    String key = overflowKey(source);
    if (key == null) return null;
    Request request = new Request.Builder().url(HOSTING + "?admission=" + key).build();
    try (Response response = ADMISSION.newCall(request).execute()) {
      if (response.isSuccessful() && response.body() != null
          && Boolean.TRUE.equals(new JSONObject(response.body().string()).opt("hosting"))) return OVERFLOW + key;
    } catch (Exception unavailable) { /* IONOS remains available if the hosting is offline. */ }
    return null;
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
