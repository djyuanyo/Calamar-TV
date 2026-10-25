package es.yuanyo.calamartv;

import android.net.Uri;
import android.util.Base64;
import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * HTTP IPTV streams (user/password/channel). They play straight from the provider, as in VLC: one
 * continuous connection, which these accounts allow. Only when the provider cannot be reached from this
 * device (blocked by the operator) they go through the hosting's bounded HTTPS transport, as on the web;
 * that host keeps using the hosting until the app is closed. Normal HLS stays direct.
 */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
final class HttpIptvDataSource implements DataSource {
  static final Uri ENDPOINT = Uri.parse("https://calamarmenciano.com/calamar-tv-relay.php?stream=1");
  /** Providers this device could not reach directly. */
  static final java.util.Set<String> RELAYED = java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<>());
  static final class Factory implements DataSource.Factory {
    private final DataSource.Factory upstream;
    private final Uri endpoint;
    Factory(DataSource.Factory upstream) { this(upstream, ENDPOINT); }
    Factory(DataSource.Factory upstream, Uri endpoint) { this.upstream=upstream; this.endpoint=endpoint; }
    @Override public DataSource createDataSource() { return new HttpIptvDataSource(upstream.createDataSource(),endpoint); }
  }
  private final DataSource upstream;
  private final Uri endpoint;
  private DataSpec request;
  private Uri original;
  private boolean iptv, relay, received;
  private volatile boolean opened;
  HttpIptvDataSource(DataSource upstream, Uri endpoint) { this.upstream=upstream; this.endpoint=endpoint; }
  @Override public void addTransferListener(TransferListener listener) { upstream.addTransferListener(listener); }
  private static String provider(Uri uri) { return uri.getHost() + ":" + uri.getPort(); }
  private DataSpec relayed(DataSpec source) {
    Map<String,String> headers=new HashMap<>(source.httpRequestHeaders);
    headers.keySet().removeIf(k -> k.equalsIgnoreCase("Range") || k.equalsIgnoreCase("Referer"));
    headers.put("X-Calamar-Source",Base64.encodeToString(original.toString().getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP));
    return source.buildUpon().setUri(endpoint).setPosition(0).setLength(C.LENGTH_UNSET)
        .setHttpRequestHeaders(headers).build();
  }
  @Override public long open(DataSpec source) throws IOException {
    original=source.uri;
    iptv=CastSource.needsBridge(original.toString());
    relay=iptv && RELAYED.contains(provider(original));
    received=false;
    request=relay ? relayed(source) : iptv ? source.buildUpon().setPosition(0).setLength(C.LENGTH_UNSET).build() : source;
    opened=true;
    if(iptv && !relay) {
      try {
        upstream.open(request);
        return C.LENGTH_UNSET;
      } catch(IOException blocked) {
        // The provider does not answer this device: the hosting reads it, as for the web.
        try { upstream.close(); } catch(IOException ignored) {}
        RELAYED.add(provider(original));
        relay=true;
        request=relayed(source);
      }
    }
    long length=upstream.open(request);
    return iptv ? C.LENGTH_UNSET : length;
  }
  @Override public int read(byte[] buffer,int offset,int length) throws IOException {
    if(length==0)return 0;
    int bytes;
    try { bytes=upstream.read(buffer,offset,length); }
    catch(IOException failure) {
      // Connected but no video came: next time this provider goes through the hosting.
      if(iptv && !relay && !received) RELAYED.add(provider(original));
      throw failure;
    }
    if(bytes>0)received=true;
    if(!iptv || bytes!=C.RESULT_END_OF_INPUT || !opened)return bytes;
    // A live channel never ends: the hosting ends a request after 120 seconds / 64 MiB on purpose, and a
    // provider may close a connection. Keep the TS extractor alive and open a fresh live connection,
    // without seeking into the old stream.
    for(int attempt=0;attempt<2 && opened;attempt++) {
      upstream.close();
      upstream.open(request);
      bytes=upstream.read(buffer,offset,length);
      if(bytes!=C.RESULT_END_OF_INPUT)return bytes;
    }
    throw new IOException(relay ? "El puente HTTPS no está recibiendo vídeo del canal" : "El proveedor IPTV ha dejado de enviar vídeo");
  }
  @Override public Uri getUri() { return iptv ? original : upstream.getUri(); }
  @Override public Map<String,List<String>> getResponseHeaders() { return upstream.getResponseHeaders(); }
  @Override public void close() throws IOException { opened=false; upstream.close(); request=null; }
}
