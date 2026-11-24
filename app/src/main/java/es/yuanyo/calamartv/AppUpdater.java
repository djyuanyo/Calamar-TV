package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.Application;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.widget.Toast;
import java.io.File;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Enforces the latest signed release on every Android screen, including playback. */
final class AppUpdater implements Application.ActivityLifecycleCallbacks {
  private static final long CHECK_INTERVAL = 5 * 60 * 1000L;
  private static final long RETRY_INTERVAL = 60 * 1000L;
  private static final String REQUIRED_MANIFEST = "required-manifest";
  private final Application app;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final SharedPreferences saved;
  private Activity foreground;
  private UpdateInfo required;
  private String manifest, errorMessage;
  private boolean checking, launching;
  private long nextCheck, verifyingId = -1, verifiedId = -1;
  private final Runnable automaticCheck = () -> check(false);
  private final Runnable poll = this::pollDownload;
  private static boolean instrumentation;

  AppUpdater(Application app) {
    this.app = app;
    saved = app.getSharedPreferences("apk-updates", Activity.MODE_PRIVATE);
    // Resume a known mandatory update even offline and import a download from the previous updater.
    manifest = saved.getString(REQUIRED_MANIFEST, saved.getString("manifest", null));
    required = parse(manifest);
    if (required == null || !required.newerThan(BuildConfig.VERSION_CODE)) {
      required = null;
      manifest = null;
      saved.edit().remove(REQUIRED_MANIFEST).apply();
      if (downloadId() != -1) clearDownload();
    }
  }

  @Override public void onActivityResumed(Activity activity) {
    foreground = activity;
    if (activity instanceof RequiredUpdateActivity) {
      launching = false;
      if (required == null) { activity.finish(); return; }
      pollDownload();
    } else enforceUpdate();
    scheduleCheck();
  }

  @Override public void onActivityPaused(Activity activity) {
    if (foreground != activity) return;
    foreground = null;
    handler.removeCallbacks(automaticCheck);
    handler.removeCallbacks(poll);
  }

  @Override public void onActivityCreated(Activity activity, Bundle state) {}
  @Override public void onActivityStarted(Activity activity) {}
  @Override public void onActivityStopped(Activity activity) {}
  @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) {}
  @Override public void onActivityDestroyed(Activity activity) {}

  private void scheduleCheck() {
    handler.removeCallbacks(automaticCheck);
    if (!instrumentation && foreground != null && !checking && downloadId() == -1) {
      handler.postDelayed(automaticCheck, Math.max(0, nextCheck - SystemClock.elapsedRealtime()));
    }
  }

  void check(boolean manual) {
    if (foreground == null || checking || instrumentation) return;
    if (downloadId() != -1) return;
    checking = true;
    if (manual) toast("Buscando actualizaciones…");
    worker.execute(() -> {
      String fetched = fetchManifest();
      UpdateInfo latest = parse(fetched);
      handler.post(() -> {
        checking = false;
        nextCheck = SystemClock.elapsedRealtime() + (latest == null ? RETRY_INTERVAL : CHECK_INTERVAL);
        if (latest != null && latest.newerThan(BuildConfig.VERSION_CODE)) {
          if (downloadId() == -1 && (required == null || latest.code > required.code
              || (latest.code == required.code && !latest.sha256.equals(required.sha256)))) {
            require(latest, fetched);
          } else enforceUpdate();
        } else if (manual && foreground != null) toast(latest == null
            ? "No se pudo comprobar la actualización. Prueba más tarde."
            : "Ya tienes la última versión: " + BuildConfig.VERSION_NAME);
        scheduleCheck();
      });
    });
  }

  private String fetchManifest() {
    try {
      HttpURLConnection connection = (HttpURLConnection) new URL(UpdateInfo.MANIFEST).openConnection();
      connection.setConnectTimeout(8000);
      connection.setReadTimeout(8000);
      connection.setUseCaches(false);
      connection.setRequestProperty("User-Agent", "CalamarTV/" + BuildConfig.VERSION_NAME);
      try {
        return connection.getResponseCode() == 200 ? Io.read(connection.getInputStream()) : null;
      } finally { connection.disconnect(); }
    } catch (Exception unavailable) { return null; }
  }

  private static UpdateInfo parse(String raw) {
    if (raw == null) return null;
    try { return new UpdateInfo(new JSONObject(raw)); }
    catch (Exception invalid) { return null; }
  }

  private void require(UpdateInfo latest, String raw) {
    required = latest;
    manifest = raw;
    saved.edit().putString(REQUIRED_MANIFEST, raw).apply();
    if (foreground instanceof RequiredUpdateActivity) pollDownload();
    else enforceUpdate();
  }

  private void enforceUpdate() {
    if (required == null || foreground == null || foreground.isFinishing() || launching
        || foreground instanceof RequiredUpdateActivity) return;
    launching = true;
    foreground.startActivity(new Intent(foreground, RequiredUpdateActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
  }

  private DownloadManager downloads() { return app.getSystemService(DownloadManager.class); }
  private long downloadId() { return saved.getLong("download", -1); }

  private void download() {
    if (downloadId() != -1) return;
    try {
      File directory = app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
      if (directory == null) throw new IOException("Sin espacio de descargas");
      String name = "Calamar-TV-" + required.version + ".apk";
      File file = new File(directory, name);
      if (file.exists() && !file.delete()) throw new IOException("No se pudo preparar la descarga");
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(required.url))
          .setTitle("Calamar TV " + required.version)
          .setDescription("Actualización de Calamar TV")
          .setMimeType("application/vnd.android.package-archive")
          .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
          .setDestinationInExternalFilesDir(app, Environment.DIRECTORY_DOWNLOADS, name);
      long id = downloads().enqueue(request);
      saved.edit().putLong("download", id).putString("manifest", manifest)
          .putString("path", file.getAbsolutePath()).apply();
      errorMessage = null;
      pollDownload();
    } catch (Exception error) {
      retryDownload("No se pudo iniciar la descarga. Comprueba el espacio disponible y vuelve a intentarlo.");
    }
  }

  private void pollDownload() {
    handler.removeCallbacks(poll);
    if (!(foreground instanceof RequiredUpdateActivity) || required == null) return;
    long id = downloadId();
    if (id == -1) {
      show(errorMessage == null ? "Versión disponible: " + required.version : errorMessage,
          "Actualizar", this::download);
      return;
    }
    if (verifiedId == id) {
      show(errorMessage == null ? "Actualización descargada. Android te pedirá confirmar la instalación." : errorMessage,
          "Instalar", this::installDownloaded);
      return;
    }
    if (verifyingId == id) {
      show("Comprobando la descarga…", "Actualizar", null);
      return;
    }
    try (Cursor result = downloads().query(new DownloadManager.Query().setFilterById(id))) {
      if (result == null || !result.moveToFirst()) {
        retryDownload("La descarga ya no está disponible. Vuelve a intentarlo.");
        return;
      }
      int state = result.getInt(result.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
      if (state == DownloadManager.STATUS_FAILED) retryDownload("La descarga ha fallado. Vuelve a intentarlo.");
      else if (state == DownloadManager.STATUS_SUCCESSFUL) {
        show("Comprobando la descarga…", "Actualizar", null);
        verifyDownload(id, required, new File(saved.getString("path", "")));
      } else {
        show(state == DownloadManager.STATUS_PAUSED ? "Esperando conexión para continuar la descarga…"
            : "Descargando la actualización…", "Actualizar", null);
        handler.postDelayed(poll, 2000);
      }
    } catch (Exception error) { retryDownload("No se pudo recuperar la descarga. Vuelve a intentarlo."); }
  }

  private void verifyDownload(long id, UpdateInfo info, File file) {
    verifyingId = id;
    worker.execute(() -> {
      String failure = null;
      try {
        info.verifyFile(file);
        PackageInfo apk = app.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), 0);
        long code = apk == null ? 0 : Build.VERSION.SDK_INT >= 28 ? apk.getLongVersionCode() : apk.versionCode;
        if (apk == null || !app.getPackageName().equals(apk.packageName) || code != info.code)
          throw new IOException("La APK no corresponde a esta actualización.");
      } catch (Exception error) {
        failure = error.getMessage();
        if (failure == null) failure = "No se pudo comprobar la actualización. Vuelve a descargarla.";
      }
      final String message = failure;
      handler.post(() -> {
        verifyingId = -1;
        if (downloadId() != id) return;
        if (message != null) retryDownload(message);
        else { verifiedId = id; pollDownload(); }
      });
    });
  }

  private void installDownloaded() {
    if (!(foreground instanceof RequiredUpdateActivity) || verifiedId != downloadId() || verifiedId == -1) return;
    if (Build.VERSION.SDK_INT >= 26 && !app.getPackageManager().canRequestPackageInstalls()) {
      errorMessage = "Permite instalar aplicaciones desde Calamar TV en Ajustes y pulsa Instalar al volver.";
      try {
        foreground.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + app.getPackageName())));
      } catch (android.content.ActivityNotFoundException unsupported) { pollDownload(); }
      return;
    }
    try {
      Uri uri = downloads().getUriForDownloadedFile(verifiedId);
      if (uri == null) { retryDownload("La descarga ya no está disponible. Vuelve a intentarlo."); return; }
      errorMessage = null;
      Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      foreground.startActivity(install);
    } catch (Exception error) {
      errorMessage = "No se pudo abrir el instalador de Android. Vuelve a intentarlo.";
      pollDownload();
    }
  }

  private void clearDownload() {
    long id = downloadId();
    saved.edit().remove("download").remove("manifest").remove("path").apply();
    verifiedId = -1;
    if (id != -1) {
      try { downloads().remove(id); } catch (RuntimeException ignored) { }
    }
  }

  private void retryDownload(String message) {
    clearDownload();
    errorMessage = message;
    pollDownload();
    scheduleCheck();
  }

  private void show(String message, String button, Runnable run) {
    ((RequiredUpdateActivity) foreground).showUpdate(message, button, run);
  }

  private void toast(String message) { Toast.makeText(app, message, Toast.LENGTH_LONG).show(); }

  static void isolateInstrumentation() {
    if (!BuildConfig.DEBUG) throw new IllegalStateException("Instrumentation only");
    instrumentation = true;
  }

  void useTestUpdate(String raw) {
    if (!instrumentation) throw new IllegalStateException("Instrumentation only");
    UpdateInfo update = parse(raw);
    required = update != null && update.newerThan(BuildConfig.VERSION_CODE) ? update : null;
    manifest = required == null ? null : raw;
    if (required == null && foreground instanceof RequiredUpdateActivity) foreground.finish();
    else enforceUpdate();
  }
}
