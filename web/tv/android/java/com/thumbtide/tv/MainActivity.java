package com.thumbtide.tv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Thumbtide on Android TV: the TV page (built by scripts/android-tv.mjs into the app's assets) in a full-screen
 * WebView. The page detects it by "ThumbtideAndroidTV" in the user agent (web/src/shell/tv.ts).
 *
 * - The remote's arrows and OK reach the page as arrow keys and Enter, as in a browser.
 * - Back is turned into an Escape key press: the page opens its pause menu, or leaves from the lobby by calling
 *   ThumbtideTV.exit().
 * - The screen stays on while the app is open: everyone plays on their phones, so the remote sits idle.
 * - Start-up options for testing: adb shell am start -n com.thumbtide.tv/.MainActivity --es params "game=cascade&bots=3"
 */
public class MainActivity extends Activity {
  private static final String PAGE = "file:///android_asset/index.html";
  private WebView web;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    if (Build.VERSION.SDK_INT >= 28) { // draw under a notch too (phones and tablets used for testing)
      WindowManager.LayoutParams lp = getWindow().getAttributes();
      lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      getWindow().setAttributes(lp);
    }
    // chrome://inspect from the computer, in development builds only (scripts/android-tv.mjs --release turns it off)
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

    web = new WebView(this);
    web.setBackgroundColor(Color.BLACK);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    // The page and its files ship inside the app. Rotor Brawl loads its sounds with XHR from those files.
    s.setAllowFileAccess(true);
    s.setAllowFileAccessFromFileURLs(true);
    s.setUserAgentString(s.getUserAgentString() + " ThumbtideAndroidTV/" + BuildConfig.VERSION);
    web.addJavascriptInterface(new Bridge(), "ThumbtideTV");
    web.setWebChromeClient(new WebChromeClient());
    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return !request.getUrl().toString().startsWith("file:///android_asset/"); // stay on the TV page
      }
    });
    setContentView(web);
    // Without focus, the remote's first press only moves focus into the page and never reaches it
    web.setFocusable(true);
    web.setFocusableInTouchMode(true);
    web.requestFocus();
    hideSystemBars();
    load(getIntent());
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    if (intent.getStringExtra("params") != null) load(intent); // a test launch with new options
  }

  private void load(Intent intent) {
    String params = intent.getStringExtra("params");
    web.loadUrl(params == null || params.isEmpty() ? PAGE : PAGE + "?" + params);
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    int code = event.getKeyCode();
    if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
      if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
        web.evaluateJavascript(
          "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,bubbles:true}))",
          null);
      }
      return true;
    }
    return super.dispatchKeyEvent(event);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemBars();
  }

  @SuppressWarnings("deprecation")
  private void hideSystemBars() {
    getWindow().getDecorView().setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }

  @Override
  protected void onPause() {
    super.onPause();
    web.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    web.onResume();
  }

  @Override
  protected void onDestroy() {
    web.destroy();
    super.onDestroy();
  }

  /** What the page can call, as window.ThumbtideTV. */
  private class Bridge {
    @JavascriptInterface
    public void exit() {
      runOnUiThread(new Runnable() {
        @Override
        public void run() {
          finish();
        }
      });
    }
  }
}
