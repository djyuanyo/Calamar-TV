package es.yuanyo.calamartv;

import android.content.Context;
import android.os.Build;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** One shared Chromium transport for document and media on Android 14+, platform on older TV. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public final class NetworkTransport implements PlayerDocument.ConnectionFactory {
  private static NetworkTransport shared;
  private final Object engine;
  private final ExecutorService callbacks = Executors.newCachedThreadPool();
  private final String initialization;

  public static synchronized NetworkTransport get(Context context) {
    if (shared == null) shared = new NetworkTransport(context.getApplicationContext());
    return shared;
  }

  private NetworkTransport(Context context) {
    Object candidate = null;
    String detail = "Sistema (HttpEngine no disponible)";
    if (Build.VERSION.SDK_INT >= 34 && android.os.ext.SdkExtensions.getExtensionVersion(31) >= 7) {
      try {
        candidate = Api34.create(context);
        detail = "Chromium / HttpEngine";
      } catch (RuntimeException | LinkageError unavailable) {
        detail = "Sistema; HttpEngine no disponible: " + unavailable.getClass().getSimpleName();
      }
    }
    engine = candidate;
    initialization = detail;
  }

  public String name() {
    return initialization;
  }

  public boolean hasChromium() {
    return engine != null;
  }

  @Override
  public HttpURLConnection open(URL url) throws IOException {
    if (Build.VERSION.SDK_INT >= 34
        && android.os.ext.SdkExtensions.getExtensionVersion(31) >= 7
        && engine != null) return Api34.open(engine, url);
    return (HttpURLConnection) url.openConnection();
  }

  public DataSource.Factory mediaFactory(String referer) {
    if (Build.VERSION.SDK_INT >= 34
        && android.os.ext.SdkExtensions.getExtensionVersion(31) >= 7
        && engine != null) return Api34.media(engine, callbacks, referer);
    return new DefaultHttpDataSource.Factory()
        .setUserAgent(PlayerDocument.USER_AGENT)
        .setConnectTimeoutMs(15000)
        .setReadTimeoutMs(15000)
        .setDefaultRequestProperties(Collections.singletonMap("Referer", referer));
  }

  // Keep new platform types isolated so old Android TV versions can load the outer class.
  @android.annotation.TargetApi(34)
  @androidx.annotation.RequiresExtension(extension = 31, version = 7)
  private static final class Api34 {
    static Object create(Context context) {
      return new android.net.http.HttpEngine.Builder(context)
          .setEnableHttp2(true)
          .setEnableQuic(true)
          .setUserAgent(PlayerDocument.USER_AGENT)
          .build();
    }

    static HttpURLConnection open(Object engine, URL url) throws IOException {
      return (HttpURLConnection) ((android.net.http.HttpEngine) engine).openConnection(url);
    }

    static DataSource.Factory media(Object engine, ExecutorService executor, String referer) {
      return new androidx.media3.datasource.HttpEngineDataSource.Factory(
              (android.net.http.HttpEngine) engine, executor)
          .setUserAgent(PlayerDocument.USER_AGENT)
          .setConnectionTimeoutMs(15000)
          .setReadTimeoutMs(15000)
          .setDefaultRequestProperties(Collections.singletonMap("Referer", referer));
    }
  }
}
