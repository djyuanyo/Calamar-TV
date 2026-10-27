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

/** Direct live IPTV transport: reconnect without seeking, never relay through the hosting. */
@android.annotation.SuppressLint("UnsafeOptInUsageError")
final class HttpIptvDataSource implements DataSource {
  static final class Factory implements DataSource.Factory {
    private final DataSource.Factory upstream;
    Factory(DataSource.Factory upstream) { this.upstream = upstream; }
    @Override public DataSource createDataSource() { return new HttpIptvDataSource(upstream.createDataSource()); }
  }
  private final DataSource upstream;
  private DataSpec request;
  private Uri original;
  private boolean iptv;
  private volatile boolean opened;
  HttpIptvDataSource(DataSource upstream) { this.upstream = upstream; }
  @Override public void addTransferListener(TransferListener listener) { upstream.addTransferListener(listener); }
  @Override public long open(DataSpec source) throws IOException {
    original = source.uri;
    iptv = CastSource.needsBridge(original.toString());
    request = iptv ? source.buildUpon().setPosition(0).setLength(C.LENGTH_UNSET).build() : source;
    opened = true;
    long length = upstream.open(request);
    return iptv ? C.LENGTH_UNSET : length;
  }
  @Override public int read(byte[] buffer,int offset,int length) throws IOException {
    if(length==0)return 0;
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
