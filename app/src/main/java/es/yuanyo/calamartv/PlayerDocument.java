package es.yuanyo.calamartv;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;

/** Fresh HTTPS document fetch, using the system network stack rather than WebView. */
public final class PlayerDocument {
  public static final String USER_AGENT = "CalamarTV/1.4.0 (Android; Media3)";

  public interface ConnectionFactory {
    HttpURLConnection open(URL url) throws IOException;
  }

  public static final class HttpFailure extends IOException {
    public final int status;

    HttpFailure(int status) {
      super("HTTP " + status);
      this.status = status;
    }
  }

  public static final class Result {
    public final String html, url;

    Result(String html, String url) {
      this.html = html;
      this.url = url;
    }
  }

  private PlayerDocument() {}

  public static Result fetch(String address) throws IOException {
    return fetch(address, url -> (HttpURLConnection) url.openConnection());
  }

  public static Result fetch(String address, ConnectionFactory connections) throws IOException {
    String current = address;
    for (int redirects = 0; redirects < 6; redirects++) {
      URI uri = URI.create(current);
      if (!"https".equalsIgnoreCase(uri.getScheme())
          || uri.getHost() == null
          || uri.getUserInfo() != null)
        throw new IOException("Dirección de reproductor no compatible");
      HttpURLConnection c = connections.open(new URL(current));
      try {
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        c.setInstanceFollowRedirects(false);
        c.setUseCaches(false);
        c.setRequestProperty("User-Agent", USER_AGENT);
        c.setRequestProperty("Accept", "text/html,application/xhtml+xml");
        c.setRequestProperty("Cache-Control", "no-cache");
        int code = c.getResponseCode();
        if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
          String location = c.getHeaderField("Location");
          if (location == null) throw new IOException("Redirección sin destino");
          current = uri.resolve(location).toString();
          continue;
        }
        if (code != 200) throw new HttpFailure(code);
        try (InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream()) {
          byte[] buffer = new byte[8192];
          int count;
          while ((count = in.read(buffer)) != -1) {
            if (out.size() + count > 2 * 1024 * 1024)
              throw new IOException("Página demasiado grande");
            out.write(buffer, 0, count);
          }
          return new Result(out.toString("UTF-8"), current);
        }
      } finally {
        c.disconnect();
      }
    }
    throw new IOException("Demasiadas redirecciones");
  }
}
