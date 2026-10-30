package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import android.content.Intent;
import android.net.Uri;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppLinksTest {
  @Test public void coldAndWarmLinksOpenTheirPageAndWaitForTheCatalog() {
    Intent initial = new Intent(ApplicationProvider.getApplicationContext(), CatalogFixtureActivity.class)
        .setAction(Intent.ACTION_VIEW).setData(Uri.parse("https://djyuanyo.github.io/Calamar-TV/directo/"));
    try (ActivityScenario<CatalogFixtureActivity> scenario = ActivityScenario.launch(initial)) {
      InstrumentationRegistry.getInstrumentation().waitForIdleSync();
      scenario.onActivity(activity -> {
        try {
        assertEquals(MainActivity.LIVE, activity.mode);
        activity.onNewIntent(new Intent(Intent.ACTION_VIEW, Uri.parse("https://djyuanyo.github.io/Calamar-TV/liga/liga-nueva/")));
        activity.openPendingAppLink();
        assertNotNull("A new league stays pending until the live catalog arrives", activity.pendingAppLink);
        try { activity.custom.put("leagues", new JSONArray().put(new JSONObject().put("id", "new-league").put("name", "Liga Nueva"))); }
        catch (JSONException e) { throw new AssertionError(e); }
        activity.openPendingAppLink();
        assertEquals(MainActivity.LEAGUE + "new-league", activity.mode);
        assertNull(activity.pendingAppLink);
        activity.onNewIntent(new Intent(Intent.ACTION_VIEW, Uri.parse("https://djyuanyo.github.io/Calamar-TV/#/canales")));
        activity.openPendingAppLink();
        assertEquals("TV", activity.mode);
        } finally {
          // ActivityScenario identifies lifecycle callbacks by the launch Intent.
          // Restore it after testing onNewIntent so closing the fixture can be observed.
          activity.setIntent(initial);
        }
      });
    }
  }
  @Test public void sharedFilmWaitsForLibraryAndOpensItsTitlePage() throws Exception {
    Intent initial = new Intent(ApplicationProvider.getApplicationContext(), CatalogFixtureActivity.class);
    try (ActivityScenario<CatalogFixtureActivity> scenario = ActivityScenario.launch(initial)) {
      InstrumentationRegistry.getInstrumentation().waitForIdleSync();
      scenario.onActivity(activity -> {
        try {
          activity.library = new Library.Data(new JSONObject("{\"sections\":{\"movies\":[{\"id\":\"m42\",\"kind\":\"movie\",\"title\":\"Portada compartida\",\"url\":\"https://calamarmenciano.com/PELIS/prueba.mp4\"}]}}"));
          assertNotNull("Fixture title must be playable in the catalog", activity.library.find("movies", "m42"));
          activity.onNewIntent(new Intent(Intent.ACTION_VIEW, Uri.parse("https://djyuanyo.github.io/Calamar-TV/peliculas/m42/")));
          activity.openPendingAppLink();
          assertNull(activity.pendingAppLink);
        } catch (JSONException e) { throw new AssertionError(e); }
        finally { activity.setIntent(initial); }
      });
      androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("Portada compartida"))
          .check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()));
      androidx.test.espresso.Espresso.pressBack();
    }
  }

}

