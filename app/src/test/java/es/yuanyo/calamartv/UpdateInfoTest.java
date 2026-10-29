package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import java.io.*;
import java.nio.file.Files;
import org.json.JSONObject;
import org.junit.Test;

public class UpdateInfoTest {
  private JSONObject manifest() throws Exception {
    return new JSONObject().put("applicationId", "es.yuanyo.calamartv").put("versionName", "2.20.19")
        .put("versionCode", 74).put("bytes", 1000000).put("sha256", new String(new char[64]).replace('\0', 'a'))
        .put("apkUrl", "https://github.com/djyuanyo/Calamar-TV/releases/download/v2.20.19/Calamar-TV-2.20.19.apk");
  }
  @Test public void onlyOffersNewerVersionCodes() throws Exception {
    UpdateInfo info = new UpdateInfo(manifest());
    assertTrue(info.newerThan(73)); assertFalse(info.newerThan(74)); assertFalse(info.newerThan(75));
  }
  @Test public void rejectsForeignDebugAndMalformedUpdates() throws Exception {
    for (JSONObject invalid : new JSONObject[] {
        manifest().put("applicationId", "other.app"), manifest().put("sha256", "bad"),
        manifest().put("bytes", -1), manifest().put("apkUrl", "https://evil.example/update.apk"),
        manifest().put("apkUrl", "https://github.com/djyuanyo/Calamar-TV/releases/download/v2.20.19/Calamar-TV-2.20.19-debug.apk")}) {
      try { new UpdateInfo(invalid); fail("Invalid manifest accepted"); } catch (IOException expected) {}
    }
  }
  @Test public void verifiesFullFileAndRejectsCorruptionOrTruncation() throws Exception {
    File file = File.createTempFile("calamar-update", ".apk");
    try {
      byte[] bytes = new byte[1000000]; bytes[2000] = 1; Files.write(file.toPath(), bytes);
      UpdateInfo info = new UpdateInfo(manifest().put("sha256", UpdateInfo.digest(file)));
      info.verifyFile(file);
      bytes[2000] = 2; Files.write(file.toPath(), bytes);
      try { info.verifyFile(file); fail("Corruption accepted"); } catch (IOException expected) {}
      Files.write(file.toPath(), new byte[5]);
      try { info.verifyFile(file); fail("Truncation accepted"); } catch (IOException expected) {}
    } finally { file.delete(); }
  }

  @Test public void newVersionsGoToEveryoneOrOnlyToTheAdministrator() throws Exception {
    assertTrue(UpdateInfo.offered(null, false));
    assertTrue(UpdateInfo.offered(new org.json.JSONObject(), false));
    assertTrue(UpdateInfo.offered(new org.json.JSONObject().put("appUpdates", "all"), false));
    assertFalse(UpdateInfo.offered(new org.json.JSONObject().put("appUpdates", "admin"), false));
    assertTrue(UpdateInfo.offered(new org.json.JSONObject().put("appUpdates", "admin"), true));
  }
}
