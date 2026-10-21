package es.yuanyo.calamartv;

import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONObject;

/** Only sends the source in an HTTPS header, never in the Cast media URL. */
final class CastAdapter {
  private static final String ENDPOINT = "https://calamarmenciano.com/calamar-cast.php";
  private final OkHttpClient client = new OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(10, TimeUnit.SECONDS).callTimeout(12, TimeUnit.SECONDS).build();

  String prepare(String address) throws Exception {
    if (!CastSource.needsBridge(address)) throw new IOException("Fuente no admitida por el adaptador.");
    String header = Base64.encodeToString(address.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    for (int attempt = 0; attempt < 35; attempt++) {
      if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
      Request request = new Request.Builder().url(ENDPOINT + "?action=start")
          .header("X-Calamar-Source", header).header("Cache-Control", "no-store").build();
      try (Response response = client.newCall(request).execute()) {
        if (!response.header("Content-Type", "").contains("application/json")) {
          throw new IOException("Falta instalar Calamar Chromecast en el hosting.");
        }
        if (response.body() == null) throw new IOException("El adaptador no ha respondido.");
        JSONObject data = new JSONObject(response.body().string());
        if (!response.isSuccessful()) throw new IOException(data.optString("error", "El hosting no pudo preparar el canal."));
        if (response.code() == 200 && !data.isNull("url")) {
          String url = data.getString("url");
          URI u = URI.create(url);
          if (!"https".equals(u.getScheme()) || !"calamarmenciano.com".equals(u.getHost())
              || u.getPort() != -1 || u.getUserInfo() != null || u.getFragment() != null
              || !"/calamar-cast.php".equals(u.getPath())
              || !u.getRawQuery().matches("action=media&session=[a-f0-9]{64}&file=live\\.m3u8")) {
            throw new IOException("Respuesta no válida del adaptador.");
          }
          return url;
        }
      }
      Thread.sleep(1000);
    }
    throw new IOException("El hosting no ha generado vídeo compatible a tiempo. Revisa la prueba de Chromecast del hosting.");
  }

  void cancel() { client.dispatcher().cancelAll(); }
}
