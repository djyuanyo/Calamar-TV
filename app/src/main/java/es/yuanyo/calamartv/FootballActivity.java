package es.yuanyo.calamartv;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Button;

/**
 * Football events are rendered by the shared GitHub Pages app, inside Android.
 * Existing ExoPlayer playback for the other TV channels is left unchanged.
 */
public class FootballActivity extends Activity {
  private static final String AGENDA = "https://djyuanyo.github.io/Calamar-TV/#/futbol";
  private FrameLayout stage;
  private WebView browser;
  private View fullScreen;
  private WebChromeClient.CustomViewCallback fullScreenCallback;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    stage = new FrameLayout(this);
    setContentView(stage);

    LinearLayout layout = new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setBackgroundColor(0xff0b0d10);
    stage.addView(layout, new FrameLayout.LayoutParams(-1,-1));

    Button back = new Button(this);
    back.setText("← Volver a canales");
    back.setOnClickListener(v -> finish());
    layout.addView(back, new LinearLayout.LayoutParams(-1,-2));

    browser = new WebView(this);
    browser.setBackgroundColor(0xff0b0d10);
    browser.getSettings().setJavaScriptEnabled(true);
    browser.getSettings().setDomStorageEnabled(true);
    browser.getSettings().setAllowFileAccess(false);
    browser.getSettings().setAllowContentAccess(false);
    browser.getSettings().setMediaPlaybackRequiresUserGesture(false);
    browser.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        return !url.startsWith("https://");
      }
    });
    browser.setWebChromeClient(new WebChromeClient() {
      @Override public void onShowCustomView(View view, CustomViewCallback callback) {
        if (fullScreen != null) { callback.onCustomViewHidden(); return; }
        fullScreen = view;
        fullScreenCallback = callback;
        stage.addView(view, new FrameLayout.LayoutParams(-1,-1,Gravity.CENTER));
        browser.setVisibility(View.GONE);
      }
      @Override public void onHideCustomView() {
        if (fullScreen == null) return;
        stage.removeView(fullScreen);
        fullScreen = null;
        browser.setVisibility(View.VISIBLE);
        if (fullScreenCallback != null) fullScreenCallback.onCustomViewHidden();
        fullScreenCallback = null;
      }
    });
    layout.addView(browser, new LinearLayout.LayoutParams(-1,0,1));
    browser.loadUrl(AGENDA);
  }

  @Override public void onBackPressed() {
    if (fullScreen != null) {
      browser.getWebChromeClient().onHideCustomView();
    } else if (browser != null && browser.canGoBack()) {
      browser.goBack();
    } else super.onBackPressed();
  }

  @Override protected void onDestroy() {
    if (browser != null) {
      browser.stopLoading();
      browser.loadUrl("about:blank");
      browser.destroy();
      browser = null;
    }
    super.onDestroy();
  }
}
