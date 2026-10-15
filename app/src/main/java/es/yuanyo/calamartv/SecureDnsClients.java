package es.yuanyo.calamartv;

import java.util.concurrent.TimeUnit;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.dnsoverhttps.DnsOverHttps;

/** TLS-verified DNS bootstrap independent of the device's resolver. */
public final class SecureDnsClients {
  private SecureDnsClients() {}

  public static OkHttpClient create(DnsProvider provider) {
    OkHttpClient base =
        new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build();
    if (provider == DnsProvider.SYSTEM) return base.newBuilder().dns(Dns.SYSTEM).build();
    DnsOverHttps dns =
        new DnsOverHttps.Builder()
            .client(base.newBuilder().callTimeout(15, TimeUnit.SECONDS).build())
            .url(HttpUrl.get(provider.endpoint))
            .bootstrapDnsHosts(provider.bootstrapAddresses())
            .includeIPv6(true)
            .post(true)
            .build();
    return base.newBuilder().dns(dns).build();
  }
}
