package es.yuanyo.calamartv;

import android.app.Activity;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * An imported match without a channel yet: where the video would go it says «Canal por confirmar», and
 * under it the match (marker, statistics, line-ups and H2H from ESPN), refreshed every 30 seconds.
 */
public class MatchActivity extends Activity {
  private final Handler handler = new Handler(Looper.getMainLooper());
  private MatchCenter matchCenter;
  private MatchCenter.Model eventModel;
  private String matchId;
  private boolean active, busy;
  private final Runnable refresh = new Runnable() { public void run() {
    if (!active || matchId == null || !matchId.matches("\\d{1,20}")) return;
    if (!busy) {
      busy = true;
      new Thread(() -> {
        MatchCenter.Model model = null;
        try { MatchScores.fetch(matchId); model = MatchCenter.merge(MatchCenter.parse(MatchScores.summary(matchId)), eventModel); } catch (Exception ignored) {}
        final MatchCenter.Model shown = model;
        handler.post(() -> { busy = false; if (!isFinishing()) { if (shown != null) matchCenter.show(shown); else matchCenter.failed(eventModel); } });
      }).start();
    }
    handler.postDelayed(this, 30000);
  }};

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    MatchScores.initialize(this);
    matchId = getIntent().getStringExtra("match_id");
    String title = getIntent().getStringExtra("title"), info = getIntent().getStringExtra("event_info");
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Ui.BG);
    root.setFitsSystemWindows(true);
    LinearLayout top = new LinearLayout(this);
    top.setGravity(Gravity.CENTER_VERTICAL);
    top.setPadding(Ui.dp(this, 8), Ui.dp(this, 6), Ui.dp(this, 14), Ui.dp(this, 6));
    ImageButton back = new ImageButton(this);
    back.setImageDrawable(Ui.icon(Ui.Icon.BACK, Ui.FG, Ui.dp(this, 24)));
    back.setBackground(Ui.focusFill(this, 0, 0x33ffffff, Ui.ACC, 999, 0));
    back.setContentDescription("Volver");
    back.setOnClickListener(v -> finish());
    top.addView(back, new LinearLayout.LayoutParams(Ui.dp(this, 46), Ui.dp(this, 46)));
    TextView heading = new TextView(this);
    heading.setText(title == null ? "Calamar TV" : title);
    heading.setTextColor(Ui.FG);
    heading.setTextSize(19);
    heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    heading.setSingleLine(true);
    heading.setEllipsize(android.text.TextUtils.TruncateAt.END);
    heading.setPadding(Ui.dp(this, 8), 0, 0, 0);
    top.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));
    root.addView(top);
    FrameLayout stage = new FrameLayout(this);
    stage.setBackgroundColor(0xff000000);
    TextView pending = new TextView(this);
    pending.setText(Competitions.PENDING + "\nEl partido se verá aquí en cuanto tenga canal.");
    pending.setTextColor(Ui.MUTED);
    pending.setTextSize(15);
    pending.setGravity(Gravity.CENTER);
    pending.setPadding(Ui.dp(this, 20), 0, Ui.dp(this, 20), 0);
    stage.addView(pending, new FrameLayout.LayoutParams(-1, -1));
    android.util.DisplayMetrics d = getResources().getDisplayMetrics();
    root.addView(stage, new LinearLayout.LayoutParams(-1, Math.min(d.widthPixels * 9 / 16, d.heightPixels / 3)));
    matchCenter = new MatchCenter(this);
    try { eventModel = MatchCenter.fromEvent(new JSONObject(info == null ? "{}" : info)); }
    catch (JSONException broken) { eventModel = MatchCenter.fromEvent(new JSONObject()); }
    eventModel.note = "Cargando los datos del partido…";
    matchCenter.show(eventModel);
    eventModel.note = "";
    root.addView(matchCenter.view, new LinearLayout.LayoutParams(-1, 0, 1));
    setContentView(root);
    back.requestFocus();
  }

  @Override protected void onResume() { super.onResume(); active = true; handler.removeCallbacks(refresh); handler.post(refresh); }
  @Override protected void onPause() { active = false; handler.removeCallbacks(refresh); super.onPause(); }
}
