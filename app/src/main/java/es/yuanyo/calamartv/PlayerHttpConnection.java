package es.yuanyo.calamartv;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** GET/HEAD adapter for the bounded, HTTPS-only document reader. */
public final class PlayerHttpConnection extends HttpURLConnection {
  private final OkHttpClient client;
  private Response response;
  private Call call;

  public PlayerHttpConnection(URL url, OkHttpClient client) {
    super(url);
    this.client = client;
  }

  @Override
  public void connect() throws IOException {
    if (connected) return;
    if (!"GET".equals(getRequestMethod()) && !"HEAD".equals(getRequestMethod()))
      throw new IOException("Método no compatible");
    Request.Builder request = new Request.Builder().url(url).method(getRequestMethod(), null);
    for (Map.Entry<String, List<String>> entry : getRequestProperties().entrySet())
      for (String value : entry.getValue()) request.addHeader(entry.getKey(), value);
    // Respect the explicit longer read budget of signed hosting resolution. Other page readers
    // retain their existing bound; a host request still has a finite total connection + read budget.
    long callMs = HostingPlayback.isRelay(url.toString())
        ? Math.max(35000L, (long) getConnectTimeout() + getReadTimeout()) : 35000L;
    OkHttpClient configured =
        client
            .newBuilder()
            .connectTimeout(getConnectTimeout(), TimeUnit.MILLISECONDS)
            .readTimeout(getReadTimeout(), TimeUnit.MILLISECONDS)
            .callTimeout(callMs, TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build();
    call = configured.newCall(request.build());
    response = call.execute();
    connected = true;
  }

  @Override
  public int getResponseCode() throws IOException {
    connect();
    return response.code();
  }

  @Override
  public String getHeaderField(String name) {
    return response == null ? null : response.header(name);
  }

  @Override
  public InputStream getInputStream() throws IOException {
    connect();
    if (response.body() == null) throw new IOException("Respuesta sin contenido");
    return response.body().byteStream();
  }

  @Override
  public InputStream getErrorStream() {
    return response != null && response.code() >= 400 && response.body() != null
        ? response.body().byteStream() : null;
  }

  @Override
  public boolean usingProxy() {
    return client.proxy() != null;
  }

  @Override
  public void disconnect() {
    if (call != null) call.cancel();
    if (response != null) response.close();
    connected = false;
  }
}
