package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.net.UnknownHostException;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.dnsoverhttps.DnsOverHttps;
import org.junit.Test;

public class SecureDnsClientsTest {
  @Test
  public void cloudflareBootstrapsWithoutDeviceDns() throws Exception {
    OkHttpClient client = SecureDnsClients.create(DnsProvider.CLOUDFLARE);
    assertTrue(client.dns() instanceof DnsOverHttps);
    DnsOverHttps dns = (DnsOverHttps) client.dns();
    assertEquals("https://cloudflare-dns.com/dns-query", dns.url().toString());
    assertEquals(
        "1.1.1.1", dns.client().dns().lookup("cloudflare-dns.com").get(0).getHostAddress());
    assertEquals(
        0, client.callTimeoutMillis()); // A live TS connection must not expire periodically.
  }

  @Test
  public void googleBootstrapsIndependently() throws Exception {
    DnsOverHttps dns = (DnsOverHttps) SecureDnsClients.create(DnsProvider.GOOGLE).dns();
    assertEquals("https://dns.google/dns-query", dns.url().toString());
    assertEquals("8.8.8.8", dns.client().dns().lookup("dns.google").get(0).getHostAddress());
  }

  @Test(expected = UnknownHostException.class)
  public void bootstrapNeverResolvesUnrelatedHostsUsingSystem() throws Exception {
    DnsOverHttps dns = (DnsOverHttps) SecureDnsClients.create(DnsProvider.CLOUDFLARE).dns();
    dns.client().dns().lookup("unexpected.example");
  }

  @Test
  public void systemIsExplicitAndUnknownPreferenceDefaultsToSecure() {
    assertSame(Dns.SYSTEM, SecureDnsClients.create(DnsProvider.SYSTEM).dns());
    assertEquals(DnsProvider.CLOUDFLARE, DnsProvider.fromPreference("invalid"));
    assertEquals(DnsProvider.CLOUDFLARE, DnsProvider.fromPreference(null));
    assertEquals(DnsProvider.GOOGLE, DnsProvider.fromPreference("GOOGLE"));
  }
}
