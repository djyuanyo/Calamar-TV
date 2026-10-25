package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import org.junit.Test;
import java.util.*;
public class AudienceModelTest {
  @Test public void canonicalTargetsAndBeatsMatchWebRules(){
    assertEquals("e:partido",AudienceModel.target(true,"partido"));assertEquals("c:canal",AudienceModel.target(false,"canal"));
    assertNull(AudienceModel.target(false,"bad/id"));assertNull(AudienceModel.target(true,""));
    assertEquals(Arrays.asList("e:p|96","e:p|97","e:p|98","e:p|99","e:p|100","e:p|101"),AudienceModel.beats("e:p",6000000));
    Map<String,Object> p=AudienceModel.presence("c:x",6000000);assertEquals(100L,p.get("minute"));assertEquals("c:x|100",p.get("beat"));assertEquals("c:x",p.get("target"));assertEquals(3,p.size());
  }
  @Test public void visitsUseMadridDayAndSeparateEventAndChannelKeys(){
    assertEquals("e_partido_a",AudienceModel.visitKey(true,"partido:a"));assertEquals("c_tv",AudienceModel.visitKey(false,"tv"));
    assertEquals("2026-07-02",AudienceModel.day(1782946800000L));
  }
  @Test public void cardsOnlyCountLiveSessionsInTheSameWindowAsWeb(){
    java.util.List<Map<String,Object>> docs=new ArrayList<>();
    docs.add(AudienceModel.presence("c:tv",6000000));docs.add(AudienceModel.presence("c:tv",5940000));
    docs.add(AudienceModel.presence("c:tv",5760000));docs.add(AudienceModel.presence("c:tv",6120000));
    docs.add(AudienceModel.presence("e:game",6000000));
    Map<String,Long> counts=AudienceModel.counts(docs,6000000);assertEquals(Long.valueOf(3),counts.get("c:tv"));assertEquals(Long.valueOf(1),counts.get("e:game"));
  }
}
