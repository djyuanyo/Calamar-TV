package es.yuanyo.calamartv;
/** Playback instrumentation fixture: never sends audience or visit records to live services. */
public final class MultiFixtureActivity extends MultiPlayerActivity {
  @Override AudienceSession createAudience(String target, String channel, AudienceSession.Count count) { return null; }
}
