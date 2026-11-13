package es.yuanyo.calamartv;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import static org.junit.Assert.*;

public class OfflineVideosTest {
  @Rule public TemporaryFolder files = new TemporaryFolder();

  @Test public void onlyDirectLibrarySourcesCanBeDownloaded() {
    assertTrue(OfflineVideos.supports("https://calamarmenciano.com/video/file.mkv"));
    assertTrue(OfflineVideos.supports("https://www.googleapis.com/drive/v3/files/abc123?alt=media"));
    String drive = "https://calamarmenciano.com/calamar-drive.php?id=abc123&v=" + "a".repeat(44);
    assertTrue(OfflineVideos.supports(drive));
    assertFalse(OfflineVideos.supports(drive + "&hls=1"));
    assertFalse(OfflineVideos.supports("https://calamarmenciano.com/video/file.m3u8"));
    assertFalse(OfflineVideos.supports("https://luluvido.com/example"));
  }

  @Test public void publishesOnlyACompleteLocalCopyAndOmitsTheOriginalLink() throws Exception {
    File temp = files.newFolder("partial");
    File dest = new File(files.getRoot(), "saved");
    JSONObject item = new JSONObject().put("key", "m1").put("title", "Película").put("url", "https://example.com/media").put("has_next", true);
    byte[] media = {1, 2, 3, 4};
    OfflineVideos.Transfer job = new OfflineVideos.Transfer(item);
    assertThrows(IOException.class, () -> OfflineVideos.store(new ByteArrayInputStream(media), 5, dest, temp, job));
    assertNull(OfflineVideos.read(dest));
    job.cancelled = true;
    assertThrows(IOException.class, () -> OfflineVideos.store(new ByteArrayInputStream(media), 4, dest, temp, job));
    assertNull(OfflineVideos.read(dest));
    job.cancelled = false;
    OfflineVideos.store(new ByteArrayInputStream(media), 4, dest, temp, job);
    OfflineVideos.Saved saved = OfflineVideos.read(dest);
    assertNotNull(saved);
    assertArrayEquals(media, java.nio.file.Files.readAllBytes(saved.video.toPath()));
    assertFalse(saved.entry.has("url"));
    assertFalse(saved.entry.optBoolean("has_next"));
    assertEquals("Película", saved.entry.optString("title"));
  }
}
