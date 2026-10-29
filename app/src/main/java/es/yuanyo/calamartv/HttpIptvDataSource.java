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

/** Live IPTV: direct first, then the HTTPS hosting if the device connection fails. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
final class HttpIptvDataSource implements DataSource {
  static final class Factory implements DataSource.Factory {
    private final DataSource.Factory upstream, relay;
    Factory(DataSource.Factory upstream) { this(upstream, null); }
    Factory(DataSource.Factory upstream, DataSource.Factory relay) { this.upstream = upstream; this.relay = relay; }
    @Override public DataSource createDataSource() {
      return new HttpIptvDataSource(upstream.createDataSource(), relay == null ? null : relay.createDataSource());
    }
  }
  static final String RELAY = "https://calamarmenciano.com/calamar-tv-relay.php?stream=1";
  private final DataSource direct, relay;
  private DataSource upstream;
  private boolean relayed;
  private DataSpec request;
  private Uri original;
  private boolean iptv;
  private volatile boolean opened;
  HttpIptvDataSource(DataSource upstream) { this(upstream, null); }
  HttpIptvDataSource(DataSource upstream, DataSource relay) { this.direct = upstream; this.upstream = upstream; this.relay = relay; }
  @Override public void addTransferListener(TransferListener listener) {
    direct.addTransferListener(listener);
    if (relay != null) relay.addTransferListener(listener);
  }
  @Override public long open(DataSpec source) throws IOException {
    original = source.uri;
    upstream = direct; relayed = false;
    iptv = CastSource.needsBridge(original.toString());
    request = iptv ? source.buildUpon().setPosition(0).setLength(C.LENGTH_UNSET).build() : source;
    opened = true;
    try {
      long length = upstream.open(request);
      return iptv ? C.LENGTH_UNSET : length;
    } catch (IOException failure) {
      if (!canRelay()) throw failure;
      openRelay();
      return C.LENGTH_UNSET;
    }
  }
  @Override public int read(byte[] buffer,int offset,int length) throws IOException {
    if(length==0)return 0;
    try { return readLive(buffer, offset, length); }
    catch (IOException failure) {
      if (!canRelay()) throw failure;
      openRelay();
      return readLive(buffer, offset, length);
    }
  }
  private boolean canRelay() { return iptv && opened && relay != null && !relayed; }
  private void openRelay() throws IOException {
    // Close the provider before opening the hosting: IPTV accounts limit simultaneous connections.
    upstream.close();
    relayed = true; upstream = relay;
    Map<String, String> headers = new HashMap<>();
    headers.put("X-Calamar-Source", Base64.encodeToString(original.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP));
    request = request.buildUpon().setUri(Uri.parse(RELAY)).setPosition(0).setLength(C.LENGTH_UNSET)
        .setHttpMethod(DataSpec.HTTP_METHOD_GET).setHttpBody(null).setHttpRequestHeaders(headers).build();
    upstream.open(request);
  }
  private int readLive(byte[] buffer, int offset, int length) throws IOException {
    int bytes = upstream.read(buffer,offset,length);
    if(!iptv || bytes!=C.RESULT_END_OF_INPUT || !opened)return bytes;
    // A provider may close a live connection. Keep the TS extractor alive and reconnect,
    // without seeking into the old stream.
    for(int attempt=0;attempt<2 && opened;attempt++) {
      upstream.close();
      upstream.open(request);
      bytes=upstream.read(buffer,offset,length);
      if(bytes!=C.RESULT_END_OF_INPUT)return bytes;
    }
    throw new IOException("El proveedor IPTV ha dejado de enviar vídeo");
  }
  @Override public Uri getUri() { return iptv ? original : upstream.getUri(); }
  @Override public Map<String,List<String>> getResponseHeaders() { return upstream.getResponseHeaders(); }
  @Override public void close() throws IOException { opened=false; upstream.close(); request=null; }
}
