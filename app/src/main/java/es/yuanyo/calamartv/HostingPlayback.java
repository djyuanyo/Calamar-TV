package es.yuanyo.calamartv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.ArrayList;
import java.util.List;

/** Obtain a signed HLS URL from the same relay used by the web. Never return a provider URL. */
final class HostingPlayback {
  private HostingPlayback() {}

  static final class Option {
    final String id, name;
    Option(String id, String name) { this.id = id; this.name = name; }
  }

  static String label(String name, String fallback) {
    String clean = (name == null ? "" : name).replaceAll("(?i)https?://\\S+|(?:[a-z0-9-]+\\.)+(?:com|cc|net|org)\\b\\S*", "")
        .replaceAll("(?i)zico\\s*tv|zicotv", "").replaceAll("^[\\s·|:-]+|[\\s·|:-]+$", "").trim();
    return clean.isEmpty() || clean.matches("(?i)(CDN|fuente|opción|servidor)\\s*\\d*") ? fallback : clean;
  }

  static List<Option> options(String page, String fallback, PlayerDocument.ConnectionFactory network) throws IOException {
    try {
      JSONObject menu = new JSONObject(fetch(Library.playerRelay(page) + "&list=1", network));
      String channel = label(menu.optString("name"), fallback);
      JSONArray items = menu.optJSONArray("items");
      List<Option> out = new ArrayList<>();
      if (items != null) for (int i = 0; i < items.length(); i++) {
        JSONObject item = items.optJSONObject(i);
        if (item == null || !item.optString("id").matches("[a-f0-9]{16}")) continue;
        out.add(new Option(item.getString("id"), label(item.optString("name"), channel + " · Señal " + (i + 1))));
      }
      if (out.isEmpty()) throw new IOException("No hay señales disponibles para este canal");
      return out;
    } catch (IOException error) { throw error; }
    catch (Exception error) { throw new IOException("No se pudieron leer las señales del canal", error); }
  }

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
    return resolve(page, "", connections);
  }

  static String resolve(String page, String id, PlayerDocument.ConnectionFactory connections) throws IOException {
    return signedUrl(fetch(request(page) + (id.isEmpty() ? "" : "&source_id=" + id), connections));
  }

  private static String fetch(String address, PlayerDocument.ConnectionFactory connections) throws IOException {
    HttpURLConnection c = connections.open(URI.create(address).toURL());
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
      return body;
    } finally { c.disconnect(); }
  }
}
