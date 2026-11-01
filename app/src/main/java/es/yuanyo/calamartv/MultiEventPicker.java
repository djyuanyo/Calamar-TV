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
    ListView list = new ListView(activity); list.setDividerHeight(Ui.dp(activity, 6)); panel.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
    TextView empty = new TextView(activity); empty.setTextColor(Ui.MUTED); panel.addView(empty); list.setEmptyView(empty);
    Button cancel = Ui.pill(activity, "Cancelar", Ui.Kind.SURFACE, true); panel.addView(cancel);
    Dialog dialog = new Dialog(activity); dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
    dialog.setContentView(panel, new android.view.ViewGroup.LayoutParams(-1, -1));
    List<Catalog.Channel> found = new ArrayList<>(events);
    BaseAdapter adapter = new BaseAdapter() {
      public int getCount() { return found.size(); }
      public Object getItem(int position) { return found.get(position); }
      public long getItemId(int position) { return position; }
      public boolean areAllItemsEnabled() { return false; }
      public boolean isEnabled(int position) { return selected.size() < MultiScreen.MAX && !selected.contains(AudienceModel.target(true, found.get(position).id)); }
      public View getView(int position, View reusable, android.view.ViewGroup parent) {
        Catalog.Channel event = found.get(position); boolean enabled = isEnabled(position);
        TextView row = reusable instanceof TextView ? (TextView) reusable : new TextView(activity);
        row.setText(event.name + "\n" + (enabled ? event.meta : "Ya está en multipantalla")); row.setTextSize(16);
        row.setTextColor(enabled ? Ui.FG : Ui.MUTED); row.setContentDescription(event.name); row.setPadding(Ui.dp(activity, 12), Ui.dp(activity, 14), Ui.dp(activity, 12), Ui.dp(activity, 14));
        row.setBackground(Ui.shape(activity, Ui.SURFACE, 10, 0, 0)); row.setEnabled(enabled); return row;
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
    draw.run(); return dialog;
  }
}
