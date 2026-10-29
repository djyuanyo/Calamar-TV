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
    List<DataSpec> requests=new ArrayList<>();int reads,closes;boolean blocked, readFailure;
    public void addTransferListener(TransferListener l){}
    public long open(DataSpec s) throws java.io.IOException {
      requests.add(s);reads=0;
      if(blocked)throw new java.io.IOException("blocked by the operator");
      return 188;
    }
    public int read(byte[] b,int o,int n) throws java.io.IOException {if(readFailure)throw new java.io.IOException("connection reset");if(reads++>0)return C.RESULT_END_OF_INPUT;b[o]=71;return 1;}
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
  @Test public void failedIptvUsesHostingOnceAndOnlyInAnHttpsHeader() throws Exception {
    Fake direct = new Fake(), relay = new Fake(); direct.blocked = true;
    HttpIptvDataSource source = new HttpIptvDataSource(direct, relay);
    String original = "http://provider.example:8080/user/password/256";
    Map<String,String> incoming = new HashMap<>(); incoming.put("Authorization", "provider-only");
    DataSpec spec = new DataSpec.Builder().setUri(Uri.parse(original)).setPosition(4000).setHttpRequestHeaders(incoming).build();
    assertEquals(C.LENGTH_UNSET, source.open(spec));
    assertEquals(1, direct.closes); assertEquals(1, relay.requests.size());
    DataSpec hosted = relay.requests.get(0);
    assertEquals(HttpIptvDataSource.RELAY, hosted.uri.toString());
    assertEquals(0, hosted.position); assertEquals(C.LENGTH_UNSET, hosted.length);
    assertEquals(Collections.singleton("X-Calamar-Source"), hosted.httpRequestHeaders.keySet());
    assertEquals(original, new String(android.util.Base64.decode(hosted.httpRequestHeaders.get("X-Calamar-Source"), android.util.Base64.NO_WRAP), java.nio.charset.StandardCharsets.UTF_8));
    assertEquals(original, source.getUri().toString());
    byte[] bytes = new byte[188]; assertEquals(1, source.read(bytes,0,188));
    assertEquals(1, source.read(bytes,0,188)); // EOF reconnects to the same hosting, not the blocked device path.
    assertEquals(1, direct.requests.size()); assertEquals(2, relay.requests.size());
    relay.readFailure = true;
    try { source.read(bytes,0,188); fail("Hosting failure must reach the player, without looping"); }
    catch (java.io.IOException expected) { assertEquals(2, relay.requests.size()); }
    source.close();
  }
  @Test public void directReadFailureClosesProviderBeforeHostedRetry() throws Exception {
    Fake direct = new Fake(), relay = new Fake();
    HttpIptvDataSource source = new HttpIptvDataSource(direct, relay);
    source.open(new DataSpec(Uri.parse("http://provider.example/user/password/256")));
    assertTrue(relay.requests.isEmpty());
    direct.readFailure = true;
    assertEquals(1, source.read(new byte[188],0,188));
    assertEquals(1, direct.closes); assertEquals(1, relay.requests.size());
    source.close();
  }
  @Test public void successfulIptvAndHlsNeverContactFallback() throws Exception {
    for (String address : new String[]{"http://provider.example/user/password/256", "https://cdn.zicotv.cc/live.m3u8"}) {
      Fake direct = new Fake(), relay = new Fake();
      HttpIptvDataSource source = new HttpIptvDataSource(direct, relay);
      source.open(new DataSpec(Uri.parse(address)));
      assertEquals(1, source.read(new byte[188],0,188));
      assertTrue(relay.requests.isEmpty()); source.close();
    }
  }
  @Test public void tdtHttpsAndLocalHttpRemainDirectAndKeepTheirEndOfInput() throws Exception {
    for(String address:new String[]{"https://tdt.example/live.m3u8","http://127.0.0.1/local.ts"}){
      Fake upstream=new Fake();HttpIptvDataSource source=new HttpIptvDataSource(upstream);
      assertEquals(188,source.open(new DataSpec(Uri.parse(address))));byte[] bytes=new byte[188];source.read(bytes,0,188);
      assertEquals(C.RESULT_END_OF_INPUT,source.read(bytes,0,188));assertEquals(address,upstream.requests.get(0).uri.toString());assertEquals(1,upstream.requests.size());source.close();
    }
  }
}
