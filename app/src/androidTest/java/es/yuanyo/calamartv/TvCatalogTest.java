package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import android.os.SystemClock;
import android.view.View;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

/** A catalog of 500 channels must not build/retain all its artwork on a TV. */
@RunWith(AndroidJUnit4.class)
public class TvCatalogTest {
  @Test public void liveSportTabsFilterAndRetainRemoteFocus() throws Exception {
    try (ActivityScenario<CatalogFixtureActivity> scenario = ActivityScenario.launch(CatalogFixtureActivity.class)) {
      scenario.onActivity(activity -> {
        try {
          activity.television = true;
          java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.ROOT);
          format.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
          String start = format.format(new java.util.Date(System.currentTimeMillis() - 60000));
          org.json.JSONArray events = new org.json.JSONArray();
          for (String sport : new String[] {"Soccer", "Basketball"}) events.put(new org.json.JSONObject()
              .put("id",sport).put("name","Partido " + sport).put("sport",sport)
              .put("startAt",start).put("cover","").put("imported",true)
              .put("streams",new org.json.JSONArray().put("https://example.org/live.m3u8")));
          activity.custom.put("events",events);
          activity.mode = MainActivity.LIVE;
          activity.home();
        } catch (org.json.JSONException failure) { throw new AssertionError(failure); }
      });
      androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withContentDescription("Baloncesto, 1 evento"))
          .perform(androidx.test.espresso.action.ViewActions.scrollTo());
      scenario.onActivity(activity -> {
        View button = activity.root.findViewById(activity.sportTabIds.get("basketball"));
        assertTrue(button.requestFocusFromTouch());
      });
      androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
          .sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_CENTER);
      androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
      scenario.onActivity(activity -> {
        assertEquals("basketball",activity.liveSport);
        View tab = activity.root.findViewById(activity.sportTabIds.get("basketball"));
        assertTrue("Selected sport keeps the remote focus",tab.hasFocus());
        java.util.List<Catalog.Channel> matches = Catalog.liveEvents(Catalog.events(activity.channels,activity.custom),System.currentTimeMillis());
        assertEquals(2,activity.eventSports.tabs(matches,activity.custom).get(0).count);
      });
      androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withContentDescription("Todos, 2 eventos"))
          .perform(androidx.test.espresso.action.ViewActions.scrollTo(), androidx.test.espresso.action.ViewActions.click());
      scenario.onActivity(activity -> assertEquals("all",activity.liveSport));
    }
  }

  @Test public void largeTvCatalogLoadsOnlyViewportAndReleasesOffscreenRows() {
    try (ActivityScenario<CatalogFixtureActivity> scenario = ActivityScenario.launch(CatalogFixtureActivity.class)) {
      scenario.onActivity(activity -> {
        activity.television = true;
        activity.mode = "TV";
        activity.home();
      });
      SystemClock.sleep(1000);
      androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
          .sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_DOWN);
      scenario.onActivity(activity -> {
        int populated = 0;
        for (MainActivity.LazySection section : activity.lazySections) if (section.getChildCount() > 0) populated++;
        assertTrue("Fixture must contain the entire catalog", activity.lazySections.size() >= 125);
        assertTrue("Initial viewport must have cards", populated > 0);
        assertTrue("Only nearby rows should be built: " + populated, populated < 15);
        assertEquals(0, activity.lazySections.get(activity.lazySections.size() - 1).getChildCount());
        activity.catalogScroll.fullScroll(View.FOCUS_DOWN);
      });
      SystemClock.sleep(1000);
      scenario.onActivity(activity -> {
        assertEquals("The final row must populate after scrolling", 1, activity.lazySections.get(activity.lazySections.size() - 1).getChildCount());
        assertEquals("Offscreen rows should release their cards", 0, activity.lazySections.get(0).getChildCount());
        MainActivity.LazySection middle = activity.lazySections.get(activity.lazySections.size() / 2);
        assertEquals(0, middle.getChildCount());
        // The remote can enter an unloaded row; it must populate before moving focus to its card.
        assertTrue("The remote must be able to focus an unloaded row", middle.requestFocus());
        assertEquals(1, middle.getChildCount());
        assertTrue(middle.hasFocus());
      });
    }
  }
}
