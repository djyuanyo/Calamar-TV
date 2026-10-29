package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import org.junit.Test;
import java.util.List;
public class MadplayPlaybackTest {
  static final String PAGE="https://jack21eo.mpanrc4imind.my/es/football/russian-cup-4436876/cska-moscow-vs-lokomotiv-moscow.html?icg=RVM";
  @Test public void currentMatchUsesTheStableHostingMenu(){assertEquals(MadplayPlayback.ENDPOINT+"/match/4436876/sources.json",MadplayPlayback.menu(PAGE));}
  @Test public void unsafePagesDoNotEnterTheMadplayRoute(){assertNull(MadplayPlayback.menu(null));assertNull(MadplayPlayback.menu(PAGE.replace(".my/",".my.evil.example/")));assertNull(MadplayPlayback.menu(PAGE.replace("https://","http://")));assertNull(MadplayPlayback.menu(PAGE.replace("https://","https://user@")));}
  @Test public void menuOnlyAcceptsStableSourcesOfTheRequestedMatch()throws Exception{
    String good=MadplayPlayback.ENDPOINT+"/match/4436876/source/905919/index.m3u8";
    List<VideoResolver.Source> rows=MadplayPlayback.parse(PAGE,"{\"items\":[{\"id\":905919,\"name\":\"VIX ES\",\"url\":\""+good+"\"},{\"id\":905919,\"url\":\""+good+"\"},{\"id\":901559,\"url\":\"https://example.com/temp.m3u8?token=secret\"},{\"id\":901560,\"url\":\""+good.replace("4436876","4522835")+"\"}]}");
    assertEquals(1,rows.size());assertEquals("VIX ES",rows.get(0).label);assertEquals(good,rows.get(0).url);assertTrue(VideoResolver.isMedia(good));assertTrue(MadplayPlayback.isRelay(good));assertFalse(MadplayPlayback.isRelay(good.replace("calamarmenciano.com","evil.example")));assertFalse(MadplayPlayback.isRelay(good+"?token=temporary"));
  }
  @Test public void unavailableMenuDoesNotInventAFallbackVideo()throws Exception{try{MadplayPlayback.parse(PAGE,"{\"items\":[]}");fail();}catch(IllegalArgumentException e){assertTrue(e.getMessage().contains("no tiene fuentes"));}}
}
