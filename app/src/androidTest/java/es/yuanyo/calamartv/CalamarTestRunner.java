package es.yuanyo.calamartv;

import android.os.Bundle;
import androidx.test.runner.AndroidJUnitRunner;

public final class CalamarTestRunner extends AndroidJUnitRunner {
  @Override public void onCreate(Bundle arguments) {
    AppAccess.useTestState(AppAccess.State.ALLOWED);
    super.onCreate(arguments);
  }
}
