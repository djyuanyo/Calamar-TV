package es.yuanyo.calamartv;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;

/** Only DNS bootstrap addresses are fixed, never CDN addresses. */
public enum DnsProvider {
  CLOUDFLARE(
      "Cloudflare · DNS seguro",
      "https://cloudflare-dns.com/dns-query",
      new byte[][] {{1, 1, 1, 1}, {1, 0, 0, 1}}),
  GOOGLE(
      "Google · DNS seguro",
      "https://dns.google/dns-query",
      new byte[][] {{8, 8, 8, 8}, {8, 8, 4, 4}}),
  SYSTEM("DNS del sistema", null, new byte[0][]);
  public final String label, endpoint;
  private final byte[][] bootstrap;

  DnsProvider(String label, String endpoint, byte[][] bootstrap) {
    this.label = label;
    this.endpoint = endpoint;
    this.bootstrap = bootstrap;
  }

  public static DnsProvider fromPreference(String value) {
    try {
      return valueOf(value);
    } catch (IllegalArgumentException | NullPointerException invalid) {
      return CLOUDFLARE;
    }
  }

  public List<InetAddress> bootstrapAddresses() {
    InetAddress[] addresses = new InetAddress[bootstrap.length];
    try {
      for (int i = 0; i < bootstrap.length; i++)
        addresses[i] = InetAddress.getByAddress(bootstrap[i]);
    } catch (UnknownHostException invalid) {
      throw new IllegalStateException(invalid);
    }
    return Arrays.asList(addresses);
  }
}
