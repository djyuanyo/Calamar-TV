package es.yuanyo.calamartv;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.Espresso.pressBackUnconditionally;
import static androidx.test.espresso.assertion.ViewAssertions.doesNotExist;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.isEnabled;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.hamcrest.Matchers.allOf;

import android.app.Instrumentation;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class RequiredUpdateTest {
  @Test public void publishedUpdateBlocksBackAndHasOnlyTheUpdateAction() throws Exception {
    String manifest = new JSONObject().put("applicationId", "es.yuanyo.calamartv").put("versionName", "9.0.0")
        .put("versionCode", BuildConfig.VERSION_CODE + 1).put("bytes", 1000000)
        .put("sha256", new String(new char[64]).replace('\0', 'a'))
        .put("apkUrl", "https://github.com/djyuanyo/Calamar-TV/releases/download/v9.0.0/Calamar-TV-9.0.0.apk")
        .toString();
    Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    CalamarApp app = (CalamarApp) instrumentation.getTargetContext().getApplicationContext();
    instrumentation.runOnMainSync(() -> app.updates.useTestUpdate(manifest));
    try (ActivityScenario<RequiredUpdateActivity> scenario = ActivityScenario.launch(RequiredUpdateActivity.class)) {
      onView(withText(RequiredUpdateActivity.MESSAGE)).check(matches(isDisplayed()));
      onView(withText("Actualizar")).check(matches(allOf(isDisplayed(), isEnabled())));
      onView(withText("Ahora no")).check(doesNotExist());
      pressBackUnconditionally();
      onView(withText(RequiredUpdateActivity.MESSAGE)).check(matches(isDisplayed()));
    } finally {
      instrumentation.runOnMainSync(() -> app.updates.useTestUpdate(null));
    }
  }
}
