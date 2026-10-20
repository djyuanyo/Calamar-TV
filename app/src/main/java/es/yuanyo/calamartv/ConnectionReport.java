package es.yuanyo.calamartv;

import java.net.ProtocolException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.SSLException;

/** Local diagnostics deliberately omit URLs, tokens, cookies and arbitrary exception messages. */
public final class ConnectionReport {
  private ConnectionReport() {}

  public static String describe(Throwable failure) {
    StringBuilder chain = new StringBuilder();
    int depth = 0;
    for (Throwable e = failure; e != null && depth++ < 8; e = e.getCause()) {
      if (chain.length() > 0) chain.append(" → ");
      chain.append(e.getClass().getSimpleName());
      if (e instanceof PlayerDocument.HttpFailure)
        return "HTTP " + ((PlayerDocument.HttpFailure) e).status;
      if (e instanceof UnknownHostException) return "DNS: no se resuelve el servidor";
      if (e instanceof SocketTimeoutException) return "Tiempo de espera agotado";
      if (e instanceof SSLException) return "Error TLS: " + e.getClass().getSimpleName();
      String message = e.getMessage() == null ? "" : e.getMessage();
      Matcher netError = Pattern.compile("(?:net::)?(ERR_[A-Z0-9_]+)").matcher(message);
      if (netError.find()) return netError.group(1);
      if (e instanceof SocketException
          && message.toLowerCase(java.util.Locale.ROOT).contains("reset"))
        return "Conexión reiniciada (RESET)";
      if (e instanceof ProtocolException) return "Protocolo HTTP: " + chain;
    }
    return chain.toString();
  }
}
