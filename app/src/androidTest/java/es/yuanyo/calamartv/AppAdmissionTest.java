package es.yuanyo.calamartv;

import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(AndroidJUnit4.class)
public class AppAdmissionTest {
  @Test public void guestWallOpensAndClosesTheCatalogWhenTheSharedPolicyChanges() {
    policy(AppAccess.State.LOGIN);
    try (ActivityScenario<CatalogFixtureActivity> scenario = ActivityScenario.launch(CatalogFixtureActivity.class)) {
      onView(withText("Continuar con Google")).check(matches(isDisplayed()));
      onView(withText("Crear cuenta")).check(matches(isDisplayed()));
      policy(AppAccess.State.ALLOWED);
      onView(withText("Multipantalla")).check(matches(isDisplayed()));
      scenario.onActivity(activity -> {
        View content = activity.findViewById(android.R.id.content);
        AppAccess.useTestState(AppAccess.State.BLOCKED);
        assertTrue(hasText(content, "Acceso suspendido"));
        assertFalse(hasText(content, "Multipantalla"));
      });
    } finally { policy(AppAccess.State.ALLOWED); }
  }

  private static void policy(AppAccess.State state) {
    InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> AppAccess.useTestState(state));
  }

  private static boolean hasText(View view, String text) {
    if (view instanceof TextView && text.contentEquals(((TextView) view).getText())) return true;
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) if (hasText(group.getChildAt(i), text)) return true;
    }
    return false;
  }
}
