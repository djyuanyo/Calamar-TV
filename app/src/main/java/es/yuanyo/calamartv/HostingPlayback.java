package es.yuanyo.calamartv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import org.json.JSONObject;

/** Obtain a signed HLS URL from the same relay used by the web. Never return a provider URL. */
final class HostingPlayback {
  private HostingPlayback() {}

  static String request(String page) {
    return Library.playerRelay(page) + "&cast=1";
  }

  static boolean isRelay(String address) {
    try {
      URI uri = URI.create(address), endpoint = URI.create(Library.PLAYER_ENDPOINT);
      return endpoint.getScheme().equals(uri.getScheme()) && endpoint.getHost().equals(uri.getHost())
          && endpoint.getPort() == uri.getPort() && endpoint.getPath().equals(uri.getPath())
          && uri.getUserInfo() == null;
    } catch (Exception invalid) { return false; }
  }

  static String signedUrl(String json) throws IOException {
    try {
      String address = URI.create(Library.PLAYER_ENDPOINT).resolve(new JSONObject(json).getString("url")).toString();
      URI uri = URI.create(address);
      if (!isRelay(address) || uri.getRawQuery() == null
          || !uri.getRawQuery().contains("seg=") || !uri.getRawQuery().contains("sig="))
        throw new IOException("El hosting devolvió una dirección de vídeo no válida");
      return address;
    } catch (IOException invalid) { throw invalid; }
    catch (Exception invalid) { throw new IOException("El hosting no devolvió una lista HLS firmada", invalid); }
  }

  static String resolve(String page, PlayerDocument.ConnectionFactory connections) throws IOException {
    HttpURLConnection c = connections.open(URI.create(request(page)).toURL());
    try {
      c.setConnectTimeout(15000); c.setReadTimeout(25000);
      c.setInstanceFollowRedirects(false); c.setUseCaches(false);
      c.setRequestProperty("User-Agent", PlayerDocument.USER_AGENT);
      c.setRequestProperty("Accept", "application/json");
      int code = c.getResponseCode();
      InputStream stream = code == 200 ? c.getInputStream() : c.getErrorStream();
      String body = "";
      if (stream != null) try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
        byte[] block = new byte[4096];
        for (int n; (n = in.read(block)) != -1;) {
          if (out.size() + n > 65536) throw new IOException("Respuesta del hosting demasiado grande");
          out.write(block, 0, n);
        }
        body = out.toString("UTF-8");
      }
      if (code != 200) {
        String detail = "";
        try { detail = new JSONObject(body).optString("error", ""); } catch (Exception ignored) { }
        throw new IOException("Hosting HTTP " + code + (detail.isEmpty() ? "" : ": " + detail));
      }
      return signedUrl(body);
    } finally { c.disconnect(); }
  }
}
