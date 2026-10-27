package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import android.net.Uri;
import androidx.media3.common.C;
import androidx.media3.datasource.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@android.annotation.SuppressLint("UnsafeOptInUsageError")
public class HttpIptvDataSourceTest {
  static class Fake implements DataSource {
    List<DataSpec> requests=new ArrayList<>();int reads,closes;boolean blocked;
    public void addTransferListener(TransferListener l){}
    public long open(DataSpec s) throws java.io.IOException {
      requests.add(s);reads=0;
      if(blocked)throw new java.io.IOException("blocked by the operator");
      return 188;
    }
    public int read(byte[] b,int o,int n){if(reads++>0)return C.RESULT_END_OF_INPUT;b[o]=71;return 1;}
    public Uri getUri(){return requests.get(requests.size()-1).uri;}
    public Map<String,List<String>> getResponseHeaders(){return Collections.emptyMap();}
    public void close(){closes++;}
  }
  @Test public void hlsFragmentsNeverUseAnEndlessIptvTransport() {
    NetworkTransport transport=NetworkTransport.get(DnsProvider.SYSTEM);
    assertFalse(transport.mediaFactory(null,false,"http://cdn.example/live.m3u8").createDataSource() instanceof HttpIptvDataSource);
    assertFalse(transport.mediaFactory(null,false,"https://tdt.example/live.m3u8").createDataSource() instanceof HttpIptvDataSource);
    assertTrue(transport.mediaFactory(null,false,"http://cdn.example/user/password/244").createDataSource() instanceof HttpIptvDataSource);
  }
  @Test public void iptvPlaysStraightFromTheProviderAsInVlc() throws Exception {
    Fake upstream=new Fake();HttpIptvDataSource source=new HttpIptvDataSource(upstream);
    String original="http://31.43.191.125:8080/user/password/244";
    assertEquals(C.LENGTH_UNSET,source.open(new DataSpec(Uri.parse(original),5000,C.LENGTH_UNSET)));
    byte[] bytes=new byte[188];assertEquals(1,source.read(bytes,0,188));
    // The provider closed the connection: a fresh live connection, never a seek into the old stream.
    assertEquals(1,source.read(bytes,0,188));
    assertEquals(2,upstream.requests.size());
    for(DataSpec request:upstream.requests){assertEquals(original,request.uri.toString());assertEquals(0,request.position);}
    source.close();
  }
  @Test public void failuresNeverRedirectCredentialsToHostingAndNextOpenRetriesDirect() throws Exception {
    Fake upstream = new Fake(); upstream.blocked = true;
    HttpIptvDataSource source = new HttpIptvDataSource(upstream);
    Uri original = Uri.parse("http://provider.example:8080/user/password/265");
    try { source.open(new DataSpec(original)); fail("Failure should reach the player"); }
    catch (java.io.IOException expected) {}
    source.close(); upstream.blocked = false;
    source.open(new DataSpec(original));
    assertEquals(2, upstream.requests.size());
    for (DataSpec request : upstream.requests) {
      assertEquals(original, request.uri);
      assertFalse(request.httpRequestHeaders.containsKey("X-Calamar-Source"));
    }
    source.close();
  }
  @Test public void tdtHttpsAndLocalHttpRemainDirectAndKeepTheirEndOfInput() throws Exception {
    for(String address:new String[]{"https://tdt.example/live.m3u8","http://127.0.0.1/local.ts"}){
      Fake upstream=new Fake();HttpIptvDataSource source=new HttpIptvDataSource(upstream);
      assertEquals(188,source.open(new DataSpec(Uri.parse(address))));byte[] bytes=new byte[188];source.read(bytes,0,188);
      assertEquals(C.RESULT_END_OF_INPUT,source.read(bytes,0,188));assertEquals(address,upstream.requests.get(0).uri.toString());assertEquals(1,upstream.requests.size());source.close();
    }
  }
}
