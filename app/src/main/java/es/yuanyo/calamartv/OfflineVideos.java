package es.yuanyo.calamartv;

import android.content.Context;
import android.net.ConnectivityManager;
import android.os.Handler;
import android.os.Looper;
import com.google.firebase.auth.FirebaseUser;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.json.JSONObject;

/** Complete local copies, scoped to the signed-in account and profile. */
final class OfflineVideos {
  static final String KEY = "offline_video";
  private static final ExecutorService worker = Executors.newSingleThreadExecutor();
  private static final Map<File, Transfer> transfers = new ConcurrentHashMap<>();
  private static final List<Runnable> listeners = new ArrayList<>();

  private OfflineVideos() {}

  static Runnable observe(Runnable listener) {
    listeners.add(listener);
    return () -> listeners.remove(listener);
  }

  private static void changed() {
    post(() -> { for (Runnable listener : new ArrayList<>(listeners)) listener.run(); });
  }

  private static void post(Runnable task) { new Handler(Looper.getMainLooper()).post(task); }

  static boolean disconnected(Context context) {
    ConnectivityManager network = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
    return network == null || network.getActiveNetwork() == null;
  }

  private static String account(Context context) {
    FirebaseUser user = Profiles.user(context);
    return user == null || user.isAnonymous() ? null : user.getUid();
  }

  static void rememberAccess(Context context, AppAccess.State state) {
    String user = account(context);
    if (user == null) return;
    android.content.SharedPreferences.Editor edit = context.getSharedPreferences("offline-access", 0).edit();
    if (state == AppAccess.State.BLOCKED) edit.remove(user).apply();
    else if (state == AppAccess.State.ALLOWED && !disconnected(context)) edit.putBoolean(user, true).apply();
  }

  static boolean admitted(Context context, AppAccess.State state) {
    if (state == AppAccess.State.BLOCKED || state == AppAccess.State.LOGIN) return false;
    if (!disconnected(context)) return state == AppAccess.State.ALLOWED;
    String user = account(context);
    return user != null && context.getSharedPreferences("offline-access", 0).getBoolean(user, false);
  }

  private static String hash(String value) {
    try {
      byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      StringBuilder key = new StringBuilder(bytes.length * 2);
      for (byte b : bytes) key.append(Character.forDigit((b & 255) >>> 4, 16)).append(Character.forDigit(b & 15, 16));
      return key.toString();
    } catch (java.security.NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
  }

  private static File directory(Context context) {
    String user = account(context), profile = Profiles.activeId();
    if (user == null || profile == null || Profiles.active() == null) return null;
    return new File(new File(context.getNoBackupFilesDir(), "offline"), hash(user + "/" + profile));
  }

  private static File folder(Context context, String key) {
    File root = directory(context);
    return root == null || key == null || key.isEmpty() ? null : new File(root, hash(key));
  }

  static boolean supports(String address) {
    if (!Library.Media.allowed(address)) return false;
    URI uri = URI.create(address);
    String path = uri.getPath();
    if (path == null) return false;
    if ("www.googleapis.com".equalsIgnoreCase(uri.getHost())) return path.startsWith("/drive/v3/files/");
    if ("/calamar-drive.php".equals(path)) return CastSource.driveCompatibility(address) != null
        && !java.util.Arrays.stream(uri.getRawQuery().split("&")).anyMatch(part -> part.startsWith("hls="));
    return ("calamarmenciano.com".equalsIgnoreCase(uri.getHost()) || "www.calamarmenciano.com".equalsIgnoreCase(uri.getHost()))
        && path.toLowerCase(Locale.ROOT).matches(".*\\.(mp4|m4v|mkv|webm|mov|avi|mpg|mpeg)$");
  }

  static final class Saved {
    final JSONObject entry;
    final File video;
    Saved(JSONObject entry, File video) { this.entry = entry; this.video = video; }
  }

  static Saved read(File folder) {
    if (folder == null) return null;
    File video = new File(folder, "media");
    if (video.length() <= 0) return null;
    try {
      JSONObject json = new JSONObject(Io.read(new java.io.FileInputStream(new File(folder, "entry.json"))));
      return video.length() == json.optLong("bytes") ? new Saved(json, video) : null;
    } catch (IOException | org.json.JSONException unreadable) { return null; }
  }

  static Saved get(Context context, String key) { return read(folder(context, key)); }

  static List<Saved> list(Context context) {
    File root = directory(context);
    File[] dirs = root == null ? null : root.listFiles(file -> file.getName().matches("[a-f0-9]{64}"));
    List<Saved> saved = new ArrayList<>();
    if (dirs != null) for (File dir : dirs) {
      Saved item = read(dir);
      if (item != null) saved.add(item);
    }
    Collections.sort(saved, (a, b) -> Long.compare(b.video.lastModified(), a.video.lastModified()));
    return saved;
  }

  static final class Transfer {
    final JSONObject entry;
    volatile boolean cancelled;
    volatile int percent = -1;
    volatile HttpURLConnection connection;
    Transfer(JSONObject entry) { this.entry = entry; }
  }

  static List<Transfer> active(Context context) {
    File root = directory(context);
    List<Transfer> result = new ArrayList<>();
    if (root != null) transfers.forEach((file, job) -> { if (root.equals(file.getParentFile())) result.add(job); });
    return result;
  }

  static void cancel(Transfer transfer) {
    transfer.cancelled = true;
    // Close from a worker to avoid blocking the UI on an in-flight read.
    HttpURLConnection connection = transfer.connection;
    if (connection != null) new Thread(connection::disconnect).start();
  }

  static boolean remove(Context context, String key) {
    File entry = folder(context, key);
    if (entry == null || transfers.containsKey(entry) || !new File(entry, "media").delete()) return false;
    clear(entry);
    changed();
    return true;
  }

  static boolean start(Context context, JSONObject entry, java.util.function.Consumer<String> result) {
    Context app = context.getApplicationContext();
    File dest = folder(app, entry.optString("key"));
    String url = entry.optString("url");
    if (dest == null || !supports(url) || get(app, entry.optString("key")) != null) return false;
    rememberAccess(app, AppAccess.current());
    Transfer transfer = new Transfer(entry);
    if (transfers.putIfAbsent(dest, transfer) != null) return false;
    changed();
    worker.execute(() -> {
      String error = "";
      File temp = new File(dest.getPath() + ".part");
      try {
        clear(temp);
        if (!temp.mkdirs()) throw new IOException("No se pudo preparar la descarga.");
        save(app, url, dest, temp, transfer);
      } catch (Exception failed) {
        error = transfer.cancelled ? "Descarga cancelada."
            : failed instanceof DownloadFailure ? failed.getMessage() : "No se pudo completar la descarga. Revisa la conexión y el espacio libre.";
      } finally {
        if (transfer.connection != null) transfer.connection.disconnect();
        clear(temp);
        transfers.remove(dest, transfer);
        changed();
      }
      String message = error.isEmpty() ? "Guardado en Descargas." : error;
      post(() -> result.accept(message));
    });
    return true;
  }

  private static void save(Context app, String url, File dest, File temp, Transfer job) throws Exception {
    if (job.cancelled) throw new IOException();
    HttpURLConnection connection = null;
    int status = 0;
    URI address = URI.create(url);
    for (int redirects = 0; redirects < 5 && !job.cancelled; redirects++) {
      connection = job.connection = NetworkTransport.get(app).openDownload(address.toURL());
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(30000);
      connection.setRequestProperty("Accept-Encoding", "identity");
      status = connection.getResponseCode();
      if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) break;
      String location = connection.getHeaderField("Location");
      connection.disconnect();
      if (location == null) throw new IOException();
      address = address.resolve(location);
      String host = address.getHost();
      if (!"https".equals(address.getScheme()) || address.getUserInfo() != null || host == null
          || !(host.equals("calamarmenciano.com") || host.equals("www.calamarmenciano.com")
          || host.equals("www.googleapis.com") || host.equals("drive.google.com")
          || host.equals("drive.usercontent.google.com") || host.endsWith(".googleusercontent.com"))) throw new IOException();
    }
    if (connection == null || job.cancelled) throw new IOException();
    String type = connection.getContentType();
    type = type == null ? "" : type.split(";")[0].trim().toLowerCase(Locale.ROOT);
    if (status != 200 || !(type.startsWith("video/") || type.equals("application/octet-stream"))
        || type.contains("mpegurl") || type.equals("video/mp2t")) {
      throw new DownloadFailure("La fuente no ofrece una descarga de vídeo compatible (HTTP " + status + ").");
    }
    long expected = connection.getHeaderFieldLong("Content-Length", -1);
    try (InputStream in = connection.getInputStream()) { store(in, expected, dest, temp, job); }
  }

  static void store(InputStream in, long expected, File dest, File temp, Transfer job) throws Exception {
    long bytes = 0;
    long space = temp.getUsableSpace();
    if (expected > space && space > 0) throw new DownloadFailure("No hay espacio suficiente para descargar este vídeo.");
    try (FileOutputStream out = new FileOutputStream(new File(temp, "media"))) {
      byte[] buffer = new byte[128 * 1024];
      for (int n; (n = in.read(buffer)) != -1;) {
        if (job.cancelled) throw new IOException();
        out.write(buffer, 0, n);
        bytes += n;
        if (expected > 0) {
          int percent = (int) Math.min(99, bytes * 100d / expected);
          if (percent != job.percent) job.percent = percent;
        }
      }
      out.getFD().sync();
    }
    if (bytes <= 0 || (expected >= 0 && expected != bytes) || job.cancelled) throw new IOException();
    JSONObject meta = new JSONObject(job.entry.toString());
    meta.remove("url");
    meta.put("bytes", bytes).put("has_next", false);
    Io.save(new File(temp, "entry.json"), meta.toString());
    clear(dest);
    if (!temp.renameTo(dest)) throw new IOException();
  }

  private static void clear(File dir) {
    File[] files = dir.listFiles();
    if (files != null) for (File file : files) file.delete();
    dir.delete();
  }

  private static final class DownloadFailure extends IOException {
    DownloadFailure(String message) { super(message); }
  }
}
