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
  @Test public void largeTvCatalogLoadsOnlyViewportAndReleasesOffscreenRows() {
    try (ActivityScenario<CatalogFixtureActivity> scenario = ActivityScenario.launch(CatalogFixtureActivity.class)) {
      scenario.onActivity(activity -> {
        activity.television = true;
        activity.mode = "Canales";
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
