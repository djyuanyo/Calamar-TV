package es.yuanyo.calamartv;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** An opaque screen so Android stops any player activity underneath it. */
public final class RequiredUpdateActivity extends Activity {
  static final String MESSAGE = "Para poder seguir disfrutando de Calamar TV, es necesario actualizar la app.";
  private TextView status;
  private Button action;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    LinearLayout screen = new LinearLayout(this);
    screen.setOrientation(LinearLayout.VERTICAL);
    screen.setGravity(Gravity.CENTER);
    int padding = Math.round(24 * getResources().getDisplayMetrics().density);
    screen.setPadding(padding, padding, padding, padding);
    screen.setBackgroundColor(Ui.BG);
    screen.setFitsSystemWindows(true);
    getWindow().setStatusBarColor(Ui.BG);
    getWindow().setNavigationBarColor(Ui.BG);
    screen.addView(label("Actualización obligatoria", 26, Ui.FG));
    screen.addView(label(MESSAGE, 17, Ui.FG));
    status = label("", 15, Ui.MUTED);
    status.setPadding(0, padding / 2, 0, padding / 2);
    screen.addView(status);
    action = Ui.pill(this, "Actualizar", Ui.Kind.ACCENT, true);
    screen.addView(action);
    setContentView(screen);
  }

  private TextView label(String text, int size, int color) {
    TextView label = new TextView(this);
    label.setText(text);
    label.setTextSize(size);
    label.setTextColor(color);
    label.setGravity(Gravity.CENTER);
    return label;
  }

  void showUpdate(String message, String button, Runnable run) {
    status.setText(message);
    action.setText(button);
    action.setEnabled(run != null);
    action.setOnClickListener(run == null ? null : view -> run.run());
    if (run != null && getCurrentFocus() == null) action.requestFocus();
  }

  @SuppressWarnings("deprecation")
  @Override public void onBackPressed() {
    // The user can leave via Android Home. Returning still requires the update.
  }
}
