package es.yuanyo.calamartv;

import android.content.Context;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.cronet.CronetDataSource;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executor;
import org.chromium.net.CronetEngine;

/** Chromium networking for documents and HLS, retaining ExoPlayer and normal TLS verification. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public final class ChromiumNetwork implements PlayerDocument.ConnectionFactory {
  private static ChromiumNetwork instance;
  private static IOException unavailable;
  private final CronetEngine engine;
  private final Executor callbacks = java.util.concurrent.Executors.newCachedThreadPool(runnable -> {
    Thread thread = new Thread(runnable, "Calamar-Cronet"); thread.setDaemon(true); return thread;
  });

  private ChromiumNetwork(Context context) {
    engine = new CronetEngine.Builder(context.getApplicationContext())
        .enableHttp2(true).enableQuic(true).setUserAgent(PlayerDocument.BROWSER_USER_AGENT).build();
  }

  public static synchronized ChromiumNetwork get(Context context) throws IOException {
    if (unavailable != null) throw unavailable;
    if (instance == null) {
      try { instance = new ChromiumNetwork(context); }
      catch (RuntimeException | LinkageError failure) {
        unavailable = new IOException("No se pudo iniciar la conexión Chromium", failure); throw unavailable;
      }
    }
    return instance;
  }

  @Override public HttpURLConnection open(URL url) throws IOException {
    return (HttpURLConnection) engine.openConnection(url);
  }

  public DataSource.Factory mediaFactory(String referer) {
    CronetDataSource.Factory factory = new CronetDataSource.Factory(engine, callbacks)
        .setUserAgent(PlayerDocument.BROWSER_USER_AGENT).setConnectionTimeoutMs(15000).setReadTimeoutMs(20000);
    if (referer != null && !referer.isEmpty()) {
      Map<String, String> headers = new HashMap<>();
      headers.put("Referer", referer); headers.put("Origin", referer.replaceAll("/+$", ""));
      factory.setDefaultRequestProperties(headers);
    }
    return factory;
  }
}
