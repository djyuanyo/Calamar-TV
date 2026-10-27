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
  /** A 188-byte TS packet on PID 256 with a PCR clock; a keyframe starts a unit. */
  static byte[] packet(double pcr,boolean key){
    byte[] p=new byte[188];long base=(long)(pcr*90000);
    p[0]=0x47;p[1]=(byte)((key?0x40:0x00)|0x01);p[2]=0x00;p[3]=0x30;p[4]=7;p[5]=(byte)(0x10|(key?0x40:0));
    p[6]=(byte)(base>>25);p[7]=(byte)(base>>17);p[8]=(byte)(base>>9);p[9]=(byte)(base>>1);p[10]=(byte)(((base&1)<<7)|0x7e);
    return p;
  }
  /** With ts, each connection sends a keyframe, a packet and the next keyframe, later in time than the one before. */
  static class Fake implements DataSource {
    List<DataSpec> requests=new ArrayList<>();int reads,closes;boolean blocked,ts;
    public void addTransferListener(TransferListener l){}
    public long open(DataSpec s) throws java.io.IOException {
      requests.add(s);reads=0;
      if(blocked)throw new java.io.IOException("blocked by the operator");
      return 188;
    }
    public int read(byte[] b,int o,int n){
      if(!ts){if(reads++>0)return C.RESULT_END_OF_INPUT;b[o]=71;return 1;}
      if(reads>=3)return C.RESULT_END_OF_INPUT;
      byte[] p=packet(10*requests.size()+reads+1,reads!=1);
      reads++;System.arraycopy(p,0,b,o,188);return 188;
    }
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
    Fake upstream=new Fake();upstream.ts=true;HttpIptvDataSource source=new HttpIptvDataSource(upstream);
    String original="http://31.43.191.125:8080/user/password/244";
    assertEquals(C.LENGTH_UNSET,source.open(new DataSpec(Uri.parse(original),5000,C.LENGTH_UNSET)));
    // A whole picture (keyframe and packet) once the next keyframe arrives.
    byte[] bytes=new byte[188];assertEquals(188,source.read(bytes,0,188));assertEquals(188,source.read(bytes,0,188));
    assertEquals(1,upstream.requests.size());
    // The provider closed the connection: a fresh live connection, never a seek into the old stream.
    assertEquals(188,source.read(bytes,0,188));
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
