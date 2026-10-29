package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;
import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Optional signed APK updates, using Android's download manager and system installer on phones/TV. */
final class AppUpdater {
  private final Activity activity;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final SharedPreferences saved;
  private boolean resumed, checking, verifying, installOpened, waitingPermission;
  private long checkedAt;
  private int offeredCode;
  private AlertDialog dialog;
  private final Runnable poll = this::pollDownload;

  /** Whether this device is offered new versions now (the administrator may keep them for himself first). */
  interface Audience { boolean offered(); }
  private final Audience audience;

  AppUpdater(Activity activity) { this(activity, () -> true); }

  AppUpdater(Activity activity, Audience audience) {
    this.audience = audience;
    this.activity = activity;
    saved = activity.getSharedPreferences("apk-updates", Activity.MODE_PRIVATE);
  }

  void resume() {
    resumed = true;
    if (waitingPermission) {
      waitingPermission = false;
      if (mayInstall()) installDownloaded();
    } else pollDownload();
    if (System.currentTimeMillis() - checkedAt > 6 * 60 * 60 * 1000L) check(false);
  }

  void pause() {
    resumed = false;
    handler.removeCallbacks(poll);
  }

  void close() {
    pause();
    worker.shutdownNow();
    handler.removeCallbacksAndMessages(null);
    if (dialog != null) dialog.dismiss();
  }

  void check(boolean manual) {
    if (checking || activity.isDestroyed()) return;
    if (saved.getLong("download", -1) != -1) {
      if (manual) { installOpened = false; pollDownload(); }
      return;
    }
    checking = true;
    checkedAt = System.currentTimeMillis();
    if (manual) toast("Buscando actualizaciones…");
    worker.execute(() -> {
      UpdateInfo info = null;
      String raw = null;
      try {
        HttpURLConnection connection = (HttpURLConnection) new URL(UpdateInfo.MANIFEST).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        connection.setUseCaches(false);
        connection.setRequestProperty("User-Agent", "CalamarTV/" + BuildConfig.VERSION_NAME);
        try {
          if (connection.getResponseCode() != 200) throw new java.io.IOException("Sin manifiesto");
          raw = Io.read(connection.getInputStream());
          info = new UpdateInfo(new JSONObject(raw));
        } finally { connection.disconnect(); }
      } catch (Exception ignored) {}
      final UpdateInfo latest = info;
      final String manifest = raw;
      handler.post(() -> {
        checking = false;
        if (!resumed || activity.isDestroyed() || activity.isFinishing()) return;
        if (latest == null) { if (manual) toast("No se pudo comprobar la actualización. Prueba más tarde."); return; }
        if (!latest.newerThan(BuildConfig.VERSION_CODE) || !audience.offered()) { if (manual) toast("Ya tienes la última versión: " + BuildConfig.VERSION_NAME); return; }
        if (!manual && (offeredCode == latest.code || saved.getLong("snooze-" + latest.code, 0) > System.currentTimeMillis())) return;
        offeredCode = latest.code;
        dialog = new AlertDialog.Builder(activity)
            .setTitle("Nueva versión " + latest.version)
            .setMessage("Tienes la versión " + BuildConfig.VERSION_NAME + ". ¿Quieres descargar la actualización? Se conservarán tus datos.")
            .setPositiveButton("Descargar", (d, which) -> download(latest, manifest))
            .setNegativeButton("Ahora no", (d, which) -> saved.edit().putLong("snooze-" + latest.code, System.currentTimeMillis() + 24 * 60 * 60 * 1000L).apply())
            .create();
        dialog.setOnDismissListener(d -> dialog = null);
        dialog.show();
      });
    });
  }

  private DownloadManager downloads() { return (DownloadManager) activity.getSystemService(Activity.DOWNLOAD_SERVICE); }

  private void download(UpdateInfo info, String manifest) {
    try {
      File directory = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
      if (directory == null) throw new java.io.IOException("Sin espacio de descargas");
      String name = "Calamar-TV-" + info.version + ".apk";
      File file = new File(directory, name);
      if (file.exists() && !file.delete()) throw new java.io.IOException("No se pudo preparar la descarga");
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(info.url))
          .setTitle("Calamar TV " + info.version)
          .setDescription("Actualización de Calamar TV")
          .setMimeType("application/vnd.android.package-archive")
          .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
          .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, name);
      long id = downloads().enqueue(request);
      saved.edit().putLong("download", id).putString("manifest", manifest).putString("path", file.getAbsolutePath()).apply();
      installOpened = false;
      toast("Descargando actualización. Puedes seguir usando la app.");
      pollDownload();
    } catch (Exception error) { toast("No se pudo iniciar la descarga. Comprueba el espacio disponible y vuelve a intentarlo."); }
  }

  private void pollDownload() {
    handler.removeCallbacks(poll);
    if (!resumed || verifying || activity.isDestroyed()) return;
    long id = saved.getLong("download", -1);
    if (id == -1) return;
    try (Cursor result = downloads().query(new DownloadManager.Query().setFilterById(id))) {
      if (result == null || !result.moveToFirst()) { clearDownload(); return; }
      int state = result.getInt(result.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
      if (state == DownloadManager.STATUS_FAILED) {
        clearDownload();
        toast("La descarga ha fallado. Pulsa Actualizaciones para volver a intentarlo.");
      } else if (state == DownloadManager.STATUS_SUCCESSFUL) {
        UpdateInfo info = new UpdateInfo(new JSONObject(saved.getString("manifest", "{}")));
        if (!info.newerThan(BuildConfig.VERSION_CODE)) { downloads().remove(id); clearDownload(); return; }
        if (!installOpened && dialog == null) verifyDownload(info, new File(saved.getString("path", "")));
      } else handler.postDelayed(poll, 2000);
    } catch (Exception error) { clearDownload(); toast("No se pudo recuperar la descarga. Vuelve a intentarlo."); }
  }

  private void verifyDownload(UpdateInfo info, File file) {
    verifying = true;
    worker.execute(() -> {
      String failure = null;
      try {
        info.verifyFile(file);
        PackageInfo apk = activity.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), 0);
        long code = apk == null ? 0 : Build.VERSION.SDK_INT >= 28 ? apk.getLongVersionCode() : apk.versionCode;
        if (apk == null || !activity.getPackageName().equals(apk.packageName) || code != info.code)
          throw new java.io.IOException("La APK no corresponde a esta actualización");
      } catch (Exception error) { failure = error.getMessage(); }
      final String message = failure;
      handler.post(() -> {
        verifying = false;
        if (activity.isDestroyed()) return;
        if (message != null) { downloads().remove(saved.getLong("download", -1)); clearDownload(); toast(message); return; }
        if (!resumed || dialog != null) return;
        dialog = new AlertDialog.Builder(activity)
            .setTitle("Actualización lista")
            .setMessage("Calamar TV " + info.version + " ya está descargada. Android te pedirá confirmar la instalación.")
            .setPositiveButton("Instalar", (d, which) -> installDownloaded())
            .setNegativeButton("Más tarde", (d, which) -> installOpened = true)
            .create();
        dialog.setOnDismissListener(d -> { dialog = null; installOpened = true; });
        dialog.show();
      });
    });
  }

  private boolean mayInstall() { return Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls(); }

  private void installDownloaded() {
    if (!mayInstall()) {
      try {
        waitingPermission = true;
        activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
        toast("Activa «Permitir desde esta fuente» para instalar la actualización");
      } catch (android.content.ActivityNotFoundException missing) {
        waitingPermission = false;
        toast("Abre Ajustes de Android y permite instalar aplicaciones desde Calamar TV");
      }
      return;
    }
    try {
      Uri uri = downloads().getUriForDownloadedFile(saved.getLong("download", -1));
      if (uri == null) throw new java.io.IOException("La descarga no está disponible");
      Intent install = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      activity.startActivity(install);
      installOpened = true;
    } catch (Exception error) { toast("No se pudo abrir el instalador de Android. Pulsa Actualizaciones para reintentarlo."); }
  }

  private void clearDownload() { saved.edit().remove("download").remove("manifest").remove("path").apply(); }
  private void toast(String message) { if (!activity.isDestroyed()) Toast.makeText(activity, message, Toast.LENGTH_LONG).show(); }
}
