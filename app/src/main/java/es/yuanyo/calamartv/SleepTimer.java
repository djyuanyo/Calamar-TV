package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.Locale;

/** A single countdown for a foreground playback session. */
public final class SleepTimer {
  static final String DEADLINE = "sleep_timer_deadline";
  static final int MULTI_SLEEP = Activity.RESULT_FIRST_USER;
  private static final int[] DURATIONS = {15, 30, 45, 60, 90, 120};
  private final Activity activity;
  private final Runnable stopPlayback;
  private final DevicePolicyManager policy;
  private final ComponentName receiver;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ImageButton button;
  private final Runnable tick = this::refresh;
  private AlertDialog dialog;
  private TextView remaining;
  private long deadline;

  public static final class LockReceiver extends DeviceAdminReceiver {}

  static boolean supported(Activity activity) {
    int mode = activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_TYPE_MASK;
    PackageManager features = activity.getPackageManager();
    return mode != Configuration.UI_MODE_TYPE_TELEVISION && !features.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        && features.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN);
  }

  SleepTimer(Activity activity, long deadline, Runnable stopPlayback) {
    this.activity = activity;
    this.deadline = deadline;
    this.stopPlayback = stopPlayback;
    policy = activity.getSystemService(DevicePolicyManager.class);
    receiver = new ComponentName(activity, LockReceiver.class);
    button = new ImageButton(activity);
    button.setPadding(Ui.dp(activity, 9), Ui.dp(activity, 9), Ui.dp(activity, 9), Ui.dp(activity, 9));
    button.setBackground(Ui.focusFill(activity, Ui.SURFACE, 0xff30352a, Ui.ACC, 999, 0));
    button.setOnClickListener(v -> show());
    paint();
  }

  View button() { return button; }
  long deadline() { return deadline; }
  void setDeadline(long value) { deadline = value; }
  boolean resume() { return refresh(); }

  void pause() { handler.removeCallbacks(tick); }

  void close() {
    pause();
    if (dialog != null) dialog.dismiss();
  }

  private boolean lockEnabled() { return policy != null && policy.isAdminActive(receiver); }

  private boolean refresh() {
    pause();
    if (deadline != 0 && deadline <= SystemClock.elapsedRealtime()) {
      deadline = 0;
      close();
      boolean lock = lockEnabled();
      stopPlayback.run();
      if (lock) {
        try { policy.lockNow(); }
        catch (SecurityException revoked) { stopped(); }
      } else stopped();
      return true;
    }
    paint();
    if (deadline != 0) handler.postDelayed(tick, Math.min(1000, Math.max(1, deadline - SystemClock.elapsedRealtime())));
    return false;
  }

  private void stopped() { Toast.makeText(activity, "Reproducción detenida por el temporizador", Toast.LENGTH_SHORT).show(); }

  private void paint() {
    if (button.isSelected() != (deadline != 0) || button.getDrawable() == null) {
      button.setSelected(deadline != 0);
      button.setImageDrawable(Ui.icon(Ui.Icon.TIMER, deadline == 0 ? Ui.FG : Ui.ACC, Ui.dp(activity, 22)));
    }
    button.setContentDescription(deadline == 0 ? "Temporizador" : "Temporizador · " + timeLeft());
    if (remaining != null) remaining.setText(deadline == 0
        ? (lockEnabled() ? "Al terminar se detendrá el vídeo y se bloqueará la pantalla." : "Al terminar se detendrá el vídeo. Puedes autorizar el bloqueo de pantalla.")
        : "Tiempo restante · " + timeLeft());
  }

  private String timeLeft() {
    long seconds = Math.max(0, (deadline - SystemClock.elapsedRealtime() + 999) / 1000);
    return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
  }

  private void show() {
    if (dialog != null) return;
    LinearLayout content = new LinearLayout(activity);
    content.setOrientation(LinearLayout.VERTICAL);
    int padding = Ui.dp(activity, 24);
    content.setPadding(padding, Ui.dp(activity, 8), padding, 0);
    remaining = new TextView(activity);
    content.addView(remaining);
    EditText input = new EditText(activity);
    input.setInputType(InputType.TYPE_CLASS_NUMBER);
    input.setHint("Minutos (1–720)");
    input.setSingleLine(true);
    content.addView(input);
    LinearLayout presets = new LinearLayout(activity);
    for (int minutes : DURATIONS) {
      Button preset = Ui.pill(activity, String.valueOf(minutes), Ui.Kind.SURFACE, false);
      preset.setMinWidth(0); preset.setMinimumWidth(0); preset.setPadding(0, 0, 0, 0);
      preset.setContentDescription(minutes + " minutos");
      preset.setOnClickListener(v -> input.setText(String.valueOf(minutes)));
      presets.addView(preset, new LinearLayout.LayoutParams(0, -2, 1));
    }
    content.addView(presets);
    AlertDialog.Builder builder = new AlertDialog.Builder(activity).setTitle("Temporizador").setView(content)
        .setPositiveButton(deadline == 0 ? "Iniciar" : "Cambiar", null).setNegativeButton("Cerrar", null);
    if (deadline != 0) builder.setNeutralButton("Cancelar temporizador", (d, which) -> { deadline = 0; refresh(); });
    else if (!lockEnabled() && activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_DEVICE_ADMIN))
      builder.setNeutralButton("Autorizar bloqueo", (d, which) -> requestLock());
    dialog = builder.create();
    dialog.setOnDismissListener(d -> { dialog = null; remaining = null; });
    paint();
    dialog.show();
    dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
      int minutes;
      try { minutes = Integer.parseInt(input.getText().toString()); }
      catch (NumberFormatException invalid) { minutes = 0; }
      if (minutes < 1 || minutes > 720) { input.setError("Escribe entre 1 y 720 minutos"); return; }
      deadline = SystemClock.elapsedRealtime() + minutes * 60000L;
      dialog.dismiss();
      refresh();
    });
  }

  private void requestLock() {
    Intent request = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
        .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, receiver)
        .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "Calamar TV usa este permiso para bloquear la pantalla al terminar un temporizador.");
    try { activity.startActivity(request); }
    catch (android.content.ActivityNotFoundException | SecurityException unavailable) {
      Toast.makeText(activity, "Este dispositivo solo puede detener la reproducción", Toast.LENGTH_LONG).show();
    }
  }
}
