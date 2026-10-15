package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import org.junit.Test;

public class ConnectionReportTest {
  @Test
  public void findsUnderlyingDnsFailure() {
    assertEquals(
        "DNS: no se resuelve el servidor",
        ConnectionReport.describe(
            new RuntimeException(new java.net.UnknownHostException("private.example"))));
  }

  @Test
  public void distinguishesResetTimeoutAndTls() {
    assertEquals(
        "Conexión reiniciada (RESET)",
        ConnectionReport.describe(new java.net.SocketException("Connection reset")));
    assertEquals(
        "Tiempo de espera agotado",
        ConnectionReport.describe(new java.net.SocketTimeoutException()));
    assertEquals(
        "Error TLS: SSLHandshakeException",
        ConnectionReport.describe(new javax.net.ssl.SSLHandshakeException("secret")));
  }

  @Test
  public void onlyExtractsSymbolicChromiumError() {
    assertEquals(
        "ERR_CONNECTION_RESET",
        ConnectionReport.describe(
            new java.io.IOException(
                "net::ERR_CONNECTION_RESET https://example.com/?token=private")));
    assertEquals(
        "IOException",
        ConnectionReport.describe(new java.io.IOException("https://example.com/?token=private")));
  }
}
