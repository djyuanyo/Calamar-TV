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

/** The same bounded HTTPS TS transport used by the public web; normal HLS stays direct. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
final class HttpIptvDataSource implements DataSource {
  static final Uri ENDPOINT = Uri.parse("https://calamarmenciano.com/calamar-tv-relay.php?stream=1");
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
  private boolean relay;
  private volatile boolean opened;
  HttpIptvDataSource(DataSource upstream, Uri endpoint) { this.upstream=upstream; this.endpoint=endpoint; }
  @Override public void addTransferListener(TransferListener listener) { upstream.addTransferListener(listener); }
  @Override public long open(DataSpec source) throws IOException {
    original=source.uri;
    relay=CastSource.needsBridge(original.toString());
    request=source;
    if(relay) {
      Map<String,String> headers=new HashMap<>(source.httpRequestHeaders);
      headers.keySet().removeIf(k -> k.equalsIgnoreCase("Range") || k.equalsIgnoreCase("Referer"));
      headers.put("X-Calamar-Source",Base64.encodeToString(original.toString().getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP));
      request=source.buildUpon().setUri(endpoint).setPosition(0).setLength(C.LENGTH_UNSET)
          .setHttpRequestHeaders(headers).build();
    }
    opened=true;
    long length=upstream.open(request);
    return relay ? C.LENGTH_UNSET : length;
  }
  @Override public int read(byte[] buffer,int offset,int length) throws IOException {
    if(length==0)return 0;
    int bytes=upstream.read(buffer,offset,length);
    if(!relay || bytes!=C.RESULT_END_OF_INPUT || !opened)return bytes;
    // The hosting deliberately ends a request after 120 seconds / 64 MiB. Keep the TS
    // extractor alive and open a fresh live connection, without seeking into the old stream.
    for(int attempt=0;attempt<2 && opened;attempt++) {
      upstream.close();
      upstream.open(request);
      bytes=upstream.read(buffer,offset,length);
      if(bytes!=C.RESULT_END_OF_INPUT)return bytes;
    }
    throw new IOException("El puente HTTPS no está recibiendo vídeo del canal");
  }
  @Override public Uri getUri() { return relay ? original : upstream.getUri(); }
  @Override public Map<String,List<String>> getResponseHeaders() { return upstream.getResponseHeaders(); }
  @Override public void close() throws IOException { opened=false; upstream.close(); request=null; }
}
