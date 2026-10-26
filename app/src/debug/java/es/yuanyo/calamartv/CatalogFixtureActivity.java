package es.yuanyo.calamartv;

import org.json.*;
import java.util.Set;
import android.view.View;

/** Emulator fixture: a large offline catalog, without live services or update prompts. */
public final class CatalogFixtureActivity extends MainActivity {
  @Override void restore() {
    try {
      JSONArray entries = new JSONArray();
      for (int i = 0; i < 500; i++) entries.put(new JSONObject().put("id", "fixture-" + i)
          .put("name", "Canal " + i).put("group", "Generalistas")
          .put("streams", new JSONArray().put("https://example.org/" + i + ".m3u8")));
      tdt = new JSONObject().put("channels", entries);
      custom = new JSONObject().put("channels", new JSONArray()).put("featured", new JSONArray()).put("hidden", new JSONArray());
      channels = Catalog.merge(tdt, custom);
    } catch (JSONException error) { throw new IllegalStateException(error); }
  }
  @Override void load() {}
  @Override void observeSharedCatalog() {}
  @Override void refreshSharedCatalog() {}
  @Override AppUpdater createUpdater() { return null; }
  @Override void collectAudienceTargets(View view, Set<String> out) {}
}
