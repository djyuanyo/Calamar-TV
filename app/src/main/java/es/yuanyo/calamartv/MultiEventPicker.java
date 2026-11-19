package es.yuanyo.calamartv;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import java.io.*;
import java.util.*;
import org.json.JSONObject;

/** Local catalog picker; selecting a tile never changes the catalog. */
final class MultiEventPicker {
  interface Pick { void choose(Catalog.Channel event); }
  private static JSONObject read(Context context, String cache, String asset) throws Exception {
    File file = new File(context.getFilesDir(), cache);
    try (InputStream in = file.isFile() ? new FileInputStream(file) : context.getAssets().open(asset)) {
      return new JSONObject(Io.read(in));
    }
  }
  static List<Catalog.Channel> events(Context context) {
    try {
      JSONObject custom = SharedCatalog.cached(context);
      if (custom == null) custom = read(context, "catalog-custom.json", "custom.json");
      JSONObject tdt = read(context, "catalog-tdt.json", "tdt.json");
      List<Catalog.Channel> out = new ArrayList<>();
      for (Catalog.Channel event : Catalog.events(Catalog.merge(tdt, custom), custom, System.currentTimeMillis(), true))
        if (!event.pending && !AppSources.forAndroid(event.streams).isEmpty()) out.add(event);
      return out;
    } catch (Exception unavailable) { return Collections.emptyList(); }
  }
  static String normalize(String value) {
    return java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).trim();
  }
  static Dialog show(Activity activity, List<String> selected, Pick picked) {
    List<Catalog.Channel> events = events(activity);
    LinearLayout panel = new LinearLayout(activity); panel.setOrientation(LinearLayout.VERTICAL);
    panel.setPadding(Ui.dp(activity, 20), Ui.dp(activity, 16), Ui.dp(activity, 20), Ui.dp(activity, 16)); panel.setBackgroundColor(Ui.BG);
    TextView title = new TextView(activity); title.setText("Añadir evento"); title.setTextSize(22); title.setTextColor(Ui.FG); panel.addView(title);
    TextView count = new TextView(activity); count.setText(selected.size() + " de " + MultiScreen.MAX + " pantallas"); count.setTextColor(Ui.MUTED); panel.addView(count);
    EditText search = new EditText(activity); search.setSingleLine(true); search.setTextColor(Ui.FG); search.setHintTextColor(Ui.MUTED);
    search.setHint("Buscar por nombre del evento"); search.setContentDescription("Buscar evento para multipantalla"); panel.addView(search, new LinearLayout.LayoutParams(-1, -2));
    GridView list = new GridView(activity);
    boolean television = (activity.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_TYPE_MASK) == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION;
    int width = activity.getResources().getConfiguration().screenWidthDp;
    list.setNumColumns(television ? Math.max(2, Math.min(4, width / 240)) : Math.max(1, Math.min(3, width / 190)));
    list.setHorizontalSpacing(Ui.dp(activity, 10)); list.setVerticalSpacing(Ui.dp(activity, 10)); list.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
    list.setSelector(Ui.shape(activity, 0x20d6ff00, 12, 3, Ui.ACC)); list.setDrawSelectorOnTop(true); list.setContentDescription("Eventos disponibles en multipantalla"); panel.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
    TextView empty = new TextView(activity); empty.setTextColor(Ui.MUTED); panel.addView(empty); list.setEmptyView(empty);
    Button cancel = Ui.pill(activity, "Cancelar", Ui.Kind.SURFACE, true); panel.addView(cancel);
    android.app.AlertDialog dialog = new android.app.AlertDialog.Builder(activity, android.R.style.Theme_Material_Dialog_Alert).create();
    dialog.setView(panel, 0, 0, 0, 0);
    EventCardImages images = new EventCardImages();
    panel.addOnAttachStateChangeListener(new View.OnAttachStateChangeListener() {
      public void onViewAttachedToWindow(View v) {}
      public void onViewDetachedFromWindow(View v) { images.close(); }
    });
    List<Catalog.Channel> found = new ArrayList<>(events);
    BaseAdapter adapter = new BaseAdapter() {
      public int getCount() { return found.size(); }
      public Object getItem(int position) { return found.get(position); }
      public long getItemId(int position) { return position; }
      public boolean areAllItemsEnabled() { return false; }
      public boolean isEnabled(int position) { return selected.size() < MultiScreen.MAX && !selected.contains(AudienceModel.target(true, found.get(position).id)); }
      public View getView(int position, View reusable, android.view.ViewGroup parent) {
        Catalog.Channel event = found.get(position); boolean enabled = isEnabled(position);
        LinearLayout row = reusable instanceof LinearLayout ? (LinearLayout) reusable : new LinearLayout(activity);
        row.removeAllViews(); row.setOrientation(LinearLayout.VERTICAL); row.setPadding(Ui.dp(activity, 3), Ui.dp(activity, 3), Ui.dp(activity, 3), Ui.dp(activity, 3));
        row.setContentDescription(event.name); row.setEnabled(enabled); row.setAlpha(enabled ? 1f : .45f); row.setBackground(Ui.shape(activity, Ui.SURFACE, 12, 1, 0x30ffffff));
        FrameLayout art = new FrameLayout(activity) { @Override protected void onMeasure(int w, int h) { super.onMeasure(w, View.MeasureSpec.makeMeasureSpec(Math.round(View.MeasureSpec.getSize(w) * 9f / 16f), View.MeasureSpec.EXACTLY)); } };
        art.setBackground(Ui.shape(activity, 0xff10271e, 10, 0, 0)); art.setClipToOutline(true);
        ImageView background = new ImageView(activity); background.setScaleType(ImageView.ScaleType.CENTER_CROP); art.addView(background, new FrameLayout.LayoutParams(-1, -1));
        images.load(background, event.cover.isEmpty() ? event.background : event.cover, false);
        if (!event.homeLogo.isEmpty() || !event.awayLogo.isEmpty()) {
          LinearLayout crests = new LinearLayout(activity); crests.setGravity(android.view.Gravity.CENTER); crests.setPadding(Ui.dp(activity, 12), Ui.dp(activity, 12), Ui.dp(activity, 12), Ui.dp(activity, 12));
          for (int i = 0; i < 3; i++) {
            if (i == 1) { TextView vs = new TextView(activity); vs.setText("VS"); vs.setTextColor(Ui.FG); vs.setGravity(android.view.Gravity.CENTER); vs.setTextSize(12); crests.addView(vs, new LinearLayout.LayoutParams(0, -1, .7f)); }
            else { ImageView crest = new ImageView(activity); crest.setScaleType(ImageView.ScaleType.FIT_CENTER); images.load(crest, i == 0 ? event.homeLogo : event.awayLogo, true); crests.addView(crest, new LinearLayout.LayoutParams(0, -1, 1)); }
          }
          art.addView(crests, new FrameLayout.LayoutParams(-1, -1));
        }
        row.addView(art, new LinearLayout.LayoutParams(-1, -2));
        TextView name = new TextView(activity); name.setText(event.name); name.setTextColor(Ui.FG); name.setTextSize(15); name.setTypeface(null, android.graphics.Typeface.BOLD); name.setMaxLines(2); name.setMinLines(2); name.setEllipsize(android.text.TextUtils.TruncateAt.END); name.setPadding(Ui.dp(activity, 10), Ui.dp(activity, 10), Ui.dp(activity, 10), 0); row.addView(name);
        TextView meta = new TextView(activity); meta.setText(enabled ? event.meta : "Ya está en multipantalla"); meta.setTextSize(12); meta.setTextColor(Ui.MUTED); meta.setMaxLines(2); meta.setEllipsize(android.text.TextUtils.TruncateAt.END); meta.setPadding(Ui.dp(activity, 10), Ui.dp(activity, 5), Ui.dp(activity, 10), Ui.dp(activity, 10)); row.addView(meta);
        return row;
      }
    };
    list.setAdapter(adapter);
    list.setOnItemClickListener((parent, row, position, id) -> { if (adapter.isEnabled(position)) { Catalog.Channel event = found.get(position); dialog.dismiss(); picked.choose(event); } });
    Runnable draw = () -> {
      found.clear(); String query = normalize(search.getText().toString());
      for (Catalog.Channel event : events) if (normalize(event.name).contains(query)) found.add(event);
      empty.setText(events.isEmpty() ? "No hay eventos disponibles." : "No hay eventos con ese nombre."); adapter.notifyDataSetChanged();
    };
    search.addTextChangedListener(new android.text.TextWatcher() {
      public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
      public void onTextChanged(CharSequence s, int start, int before, int count) { draw.run(); }
      public void afterTextChanged(android.text.Editable text) {}
    });
    cancel.setOnClickListener(v -> dialog.dismiss()); dialog.show();
    dialog.getWindow().setBackgroundDrawableResource(android.R.color.black); dialog.getWindow().setLayout(-1, -1); dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
    draw.run(); search.requestFocus(); return dialog;
  }
}
