package es.yuanyo.calamartv;

import java.io.*;

/** Small bounded file and stream helpers shared by the catalog and the user's channels. */
public final class Io {
  private Io() {}

  public static String read(InputStream in) throws IOException {
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int n;
      while ((n = in.read(buffer)) != -1) {
        if (out.size() + n > 8 * 1024 * 1024) throw new IOException("Respuesta demasiado grande");
        out.write(buffer, 0, n);
      }
      return out.toString("UTF-8");
    } finally {
      in.close();
    }
  }

  /** Writes through a temporary file so an interrupted save never leaves a truncated file. */
  public static void save(File file, String content) throws IOException {
    File temporary = new File(file.getPath() + ".tmp");
    try (FileOutputStream out = new FileOutputStream(temporary)) {
      out.write(content.getBytes("UTF-8"));
      out.getFD().sync();
    }
    if (!temporary.renameTo(file)) throw new IOException("No se pudo guardar " + file.getName());
  }
}
