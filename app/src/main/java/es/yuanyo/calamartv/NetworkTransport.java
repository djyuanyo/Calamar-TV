package es.yuanyo.calamartv;

import android.content.Context;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.EnumMap;
import okhttp3.OkHttpClient;

/** The selected resolver covers the player page, media lists, segments and keys. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public final class NetworkTransport implements PlayerDocument.ConnectionFactory {
  private static final EnumMap<DnsProvider, NetworkTransport> CLIENTS =
      new EnumMap<>(DnsProvider.class);
  public final DnsProvider provider;
  private final OkHttpClient client;

  public static DnsProvider selected(Context context) {
    return DnsProvider.fromPreference(
        context
            .getSharedPreferences("player-network", Context.MODE_PRIVATE)
            .getString("dns_provider", DnsProvider.CLOUDFLARE.name()));
  }

  public static void select(Context context, DnsProvider provider) {
    context
        .getSharedPreferences("player-network", Context.MODE_PRIVATE)
        .edit()
        .putString("dns_provider", provider.name())
        .apply();
  }

  public static synchronized NetworkTransport get(Context context) {
    return get(selected(context));
  }

  public static synchronized NetworkTransport get(DnsProvider provider) {
    NetworkTransport transport = CLIENTS.get(provider);
    if (transport == null) {
      transport = new NetworkTransport(provider);
      CLIENTS.put(provider, transport);
    }
    return transport;
  }

  private NetworkTransport(DnsProvider provider) {
    this.provider = provider;
    client = SecureDnsClients.create(provider);
  }

  public String name() {
    return "OkHttp · " + provider.label;
  }

  @Override
  public HttpURLConnection open(URL url) {
    return new PlayerHttpConnection(url, client);
  }

  public DataSource.Factory mediaFactory(String referer) {
    OkHttpDataSource.Factory factory =
        new OkHttpDataSource.Factory(client).setUserAgent(PlayerDocument.USER_AGENT);
    if (referer != null && !referer.isEmpty())
      factory.setDefaultRequestProperties(Collections.singletonMap("Referer", referer));
    return factory;
  }
}
