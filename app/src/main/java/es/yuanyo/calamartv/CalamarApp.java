package es.yuanyo.calamartv;

import android.app.Application;

public final class CalamarApp extends Application {
  AppUpdater updates;

  @Override public void onCreate() {
    super.onCreate();
    updates = new AppUpdater(this);
    registerActivityLifecycleCallbacks(updates);
  }
}
