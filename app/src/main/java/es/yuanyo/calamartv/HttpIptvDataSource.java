package es.yuanyo.calamartv;

import android.net.Uri;
import androidx.media3.common.C;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;
import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Direct live IPTV transport: reconnect without seeking, never relay through the hosting. These
 * providers close each connection after a while and every new one starts again with the last ~40 s
 * they keep: TsSplicer passes on only what comes after the last moment already played, so the
 * picture never goes back or plays in pieces.
 */
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
  private TsSplicer splicer;
  private final byte[] raw = new byte[64 * 1024];
  private byte[] pending = new byte[0];
  private int pendingAt;
  HttpIptvDataSource(DataSource upstream) { this.upstream = upstream; }
  @Override public void addTransferListener(TransferListener listener) { upstream.addTransferListener(listener); }
  @Override public long open(DataSpec source) throws IOException {
    original = source.uri;
    iptv = CastSource.needsBridge(original.toString());
    request = iptv ? source.buildUpon().setPosition(0).setLength(C.LENGTH_UNSET).build() : source;
    splicer = new TsSplicer(); pending = new byte[0]; pendingAt = 0;
    opened = true;
    long length = upstream.open(request);
    return iptv ? C.LENGTH_UNSET : length;
  }
  @Override public int read(byte[] buffer,int offset,int length) throws IOException {
    if(length==0)return 0;
    if(!iptv)return upstream.read(buffer,offset,length);
    // A provider may close a live connection. Keep the TS extractor alive and reconnect, without
    // seeking into the old stream and without the stretch the new connection repeats.
    long quietSince=System.currentTimeMillis();
    int empty=0;
    while(pendingAt>=pending.length) {
      int bytes=upstream.read(raw,0,raw.length);
      if(bytes==C.RESULT_END_OF_INPUT) {
        if(!opened)return C.RESULT_END_OF_INPUT;
        // Connections that bring nothing new for 30 s (or 3 in a row with no data at all): the channel stopped.
        if(System.currentTimeMillis()-quietSince>30000 || ++empty>3) throw new IOException("El proveedor IPTV ha dejado de enviar vídeo");
        upstream.close();
        splicer.nextConnection();
        upstream.open(request);
        continue;
      }
      if(bytes>0)empty=0;
      pending=splicer.feed(raw,0,bytes);
      pendingAt=0;
    }
    int n=Math.min(length,pending.length-pendingAt);
    System.arraycopy(pending,pendingAt,buffer,offset,n);
    pendingAt+=n;
    return n;
  }
  @Override public Uri getUri() { return iptv ? original : upstream.getUri(); }
  @Override public Map<String,List<String>> getResponseHeaders() { return upstream.getResponseHeaders(); }
  @Override public void close() throws IOException { opened=false; upstream.close(); request=null; }
}
