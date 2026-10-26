package es.yuanyo.calamartv;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONObject;

/** Manifest published alongside the signed APK, after the Android checks have passed. */
final class UpdateInfo {
  static final String MANIFEST = "https://github.com/djyuanyo/Calamar-TV/releases/latest/download/Calamar-TV-update.json";
  final String version, url, sha256;
  final int code;
  final long bytes;

  UpdateInfo(JSONObject data) throws Exception {
    version = data.getString("versionName");
    code = data.getInt("versionCode");
    bytes = data.getLong("bytes");
    sha256 = data.getString("sha256").toLowerCase(Locale.ROOT);
    url = data.getString("apkUrl");
    String expected = "https://github.com/djyuanyo/Calamar-TV/releases/download/v" + version
        + "/Calamar-TV-" + version + ".apk";
    if (!"es.yuanyo.calamartv".equals(data.getString("applicationId"))
        || !version.matches("[0-9]+\\.[0-9]+\\.[0-9]+") || code < 1
        || bytes < 1000000 || bytes > 200L * 1024 * 1024
        || !sha256.matches("[0-9a-f]{64}") || !expected.equals(url))
      throw new IOException("Información de actualización no válida");
  }

  boolean newerThan(int installed) { return code > installed; }

  static String digest(File file) throws Exception {
    MessageDigest hash = MessageDigest.getInstance("SHA-256");
    try (FileInputStream in = new FileInputStream(file)) {
      byte[] block = new byte[32768];
      for (int n; (n = in.read(block)) != -1;) hash.update(block, 0, n);
    }
    StringBuilder out = new StringBuilder();
    for (byte value : hash.digest()) out.append(String.format(Locale.ROOT, "%02x", value & 255));
    return out.toString();
  }

  void verifyFile(File file) throws Exception {
    if (!file.isFile() || file.length() != bytes || !sha256.equals(digest(file)))
      throw new IOException("La descarga no está completa. Vuelve a descargar la actualización.");
  }
}
