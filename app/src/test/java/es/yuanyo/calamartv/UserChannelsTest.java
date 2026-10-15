package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.io.File;
import org.json.*;
import org.junit.Test;

public class UserChannelsTest {
  @Test
  public void acceptsHttpAndHttpsLinks() {
    assertEquals(
        "http://example.com:8880/live/a/b/1.ts",
        UserChannels.normalize("  http://example.com:8880/live/a/b/1.ts "));
    assertNotNull(UserChannels.normalize("https://example.com/stream.m3u8"));
  }

  @Test
  public void rejectsOtherSchemesAndBrokenLinks() {
    assertNull(UserChannels.normalize("file:///sdcard/video.ts"));
    assertNull(UserChannels.normalize("javascript:alert(1)"));
    assertNull(UserChannels.normalize("example.com/video.ts"));
    assertNull(UserChannels.normalize("http://"));
    assertNull(UserChannels.normalize(""));
    assertNull(UserChannels.normalize(null));
  }

  @Test
  public void detectsContainerFromPath() {
    assertEquals("ts", UserChannels.kind("http://example.com/live/1.TS"));
    assertEquals("hls", UserChannels.kind("https://example.com/a/index.m3u8?token=x"));
    assertEquals("dash", UserChannels.kind("https://example.com/manifest.mpd"));
    assertNull(UserChannels.kind("http://example.com/live/1"));
  }

  @Test
  public void addEditAndRemoveKeepOrder() throws Exception {
    JSONArray list = UserChannels.add(new JSONArray(), "Uno", "http://example.com/1.ts");
    list = UserChannels.add(list, " ", "http://example.com/2.ts");
    assertEquals("Canal 2", list.getJSONObject(1).getString("name"));
    list = UserChannels.replace(list, 0, "Uno HD", "https://example.com/1.m3u8");
    assertEquals("Uno HD", list.getJSONObject(0).getString("name"));
    assertEquals("https://example.com/1.m3u8", list.getJSONObject(0).getString("url"));
    list = UserChannels.remove(list, 0);
    assertEquals(1, list.length());
    assertEquals("http://example.com/2.ts", list.getJSONObject(0).getString("url"));
  }

  @Test(expected = JSONException.class)
  public void invalidLinkIsNotStored() throws Exception {
    UserChannels.add(new JSONArray(), "Malo", "ftp://example.com/1.ts");
  }

  @Test
  public void damagedEntriesAreSkippedOnLoad() {
    JSONArray list =
        UserChannels.decode(
            "[{\"name\":\"Bien\",\"url\":\"http://example.com/1.ts\"},"
                + "{\"name\":\"Mal\",\"url\":\"nada\"},3]");
    assertEquals(1, list.length());
    assertEquals(0, UserChannels.decode("no es json").length());
  }

  @Test
  public void savedChannelsAreReadBack() throws Exception {
    File file = File.createTempFile("channels", ".json");
    file.deleteOnExit();
    JSONArray list = UserChannels.add(new JSONArray(), "Uno", "http://example.com/1.ts");
    UserChannels.save(file, list);
    JSONArray loaded = UserChannels.load(file);
    assertEquals(1, loaded.length());
    assertEquals("Uno", loaded.getJSONObject(0).getString("name"));
    assertEquals(0, UserChannels.load(new File(file.getPath() + ".missing")).length());
  }
}
