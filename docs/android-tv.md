# The Android TV app

Thumbtide's TV page can be installed on an Android TV or Google TV as an app, so the TV runs the game itself
instead of a laptop plugged into it. It's the Android counterpart of [the LG app](lg-tv.md): the same TV page, in a
full-screen WebView.

The code is in `web/tv/android/` (manifest, `MainActivity.java`, banner and icons) and `web/scripts/android-tv.mjs`
(build, install, open). The page recognises the app by `ThumbtideAndroidTV` in its user agent (`web/src/shell/tv.ts`).

## The TV we test on

| | |
|---|---|
| Model | TCL "Smart TV Pro" |
| Android TV | 14, security patch 5 December 2025 |
| Build | `tcl9618-user 14 UTT2.250416.001 AU02` |

## First-time setup

### On the TV (once)

1. **Turn on Developer options.** *Settings → System → About*, select **Android TV OS build** and press OK on it
   7 times, until the TV says you're a developer.
2. **Turn on debugging.** *Settings → System → Developer options*: turn on **USB debugging**. (The name says USB,
   but it also allows installs over Wi-Fi.)
3. **Find the TV's IP address.** *Settings → Network & Internet →* your Wi-Fi network. Give it a fixed address in your
   router (a "DHCP reservation") so it doesn't change.

### On the computer

You need the **Android SDK** and **Java**. Installing [Android Studio](https://developer.android.com/studio) gives you
both; the script finds them in their usual places (`ANDROID_HOME` or `~/Library/Android/sdk`, and Android Studio's own
Java, or `JAVA_HOME`). No Gradle and no Android Studio project are needed.

Then, from the repo root, with the computer and the TV on the same Wi-Fi:

```sh
pnpm dev                                   # in one terminal: the site and the relay
pnpm tv:android --tv=<TV IP>               # in another: build, install and open the app
```

The first time, the TV asks **"Allow USB debugging?"** for this computer. Tick *Always allow from this computer*,
choose **Allow**, and run the command again.

**If the TV refuses the connection** (`failed to connect` or `connection refused`), it only accepts Wi-Fi debugging
through pairing. In *Developer options*, open **Wireless debugging**, turn it on, choose **Pair device with pairing
code**, and run the `adb pair` line below with the address and code the TV shows. Then install using the address on
the *Wireless debugging* screen itself (the port there is different from the pairing port):

```sh
~/Library/Android/sdk/platform-tools/adb pair <TV IP>:<pairing port> <code>
pnpm tv:android --tv=<TV IP>:<port>
```

After that, Thumbtide is in the TV's apps, with its banner, and opens like any other app.

## Commands

From the repo root:

| Command | What it does |
|---|---|
| `pnpm tv:android --tv=<TV IP>` | Build, install over Wi-Fi and open the app |
| `pnpm tv:android` | The same, on the one device `adb` is already connected to |
| `pnpm tv:android --build` | Only build `web/dist-android/thumbtide.apk` |
| `pnpm tv:android --params="game=cascade&bots=3"` | Open straight into a game. Any option of the TV page works (`look=reactor`, `quality=high`…) |
| `pnpm tv:android --release` | A build without WebView debugging (development builds have it on) |

Handy `adb` commands (`~/Library/Android/sdk/platform-tools/adb`, add `-s <TV IP>:5555` when several devices are
connected):

| Command | What it does |
|---|---|
| `adb shell am force-stop com.thumbtide.tv` | Close the app (the first thing to try when it's stuck) |
| `adb shell am start -n com.thumbtide.tv/.MainActivity` | Open it |
| `adb uninstall com.thumbtide.tv` | Uninstall |
| `adb logcat \| grep chromium` | The page's errors |

**DevTools:** with a development build open on the TV, Chrome's `chrome://inspect` on the computer lists the app's
page (after `adb connect`), so you can inspect it like a web page.

**Without adb:** `web/dist-android/thumbtide.apk` can also be copied to the TV on a USB stick (or with a "send files to
TV" app) and opened from the TV's file manager, once *Install unknown apps* is allowed for that file manager.

## How the app works

`pnpm tv:android` runs `web/scripts/android-tv.mjs`, which:

1. Builds the TV page exactly as the LG app does (`vite build --mode tv`: one plain script, relative paths) into the
   app's `assets/`, with the relay and phone addresses fixed to this computer's LAN address (`ws://<IP>:8787`,
   `http://<IP>:5173/join/`). **Rebuild when the computer's IP changes.** For a deployed relay, set
   `VITE_RELAY_URL` and `VITE_JOIN_URL` first.
2. Builds the app with the SDK's own tools (`aapt2`, `javac`, `d8`, `zipalign`, `apksigner`), signs it with the
   standard Android debug key (`~/.android/debug.keystore`, made if missing) and installs it with `adb`.

In the app (`MainActivity.java`):

- **The remote.** Arrows and OK reach the page as arrow keys and Enter, as in a browser. **Back** becomes an Escape
  key press: in a game it opens the pause menu, in the lobby it closes the app (`ThumbtideTV.exit()`).
- **The screen stays on** while the app is open, since everyone plays on their phones and the remote sits idle.
- **Sound** can start without a press on the remote.
- **Files:** the page loads from `file:///android_asset/`. File access is switched on so Rotor Brawl can load its
  sound files (XHR, as on the LG TV). Plain `ws://` and `http://` are allowed for the relay on the home network.
- **Lighter mode:** the page uses the same lighter game modes as on LG TVs (`isTV` in `shell/tv.ts`): Wet Paint's low
  quality and 30fps cap, Cascade's lite look, Rotor Brawl's TV mode. A modern Android TV may be fast enough for the
  full versions; measure before switching them off.

## Tested so far

On the Android 14 emulator (the same Android version as the TCL), 2026-11-21: the app opens the lobby and connects
to the relay, a phone joins and starts a game, Cascade and Rotor Brawl run, Rotor Brawl's sounds and font load, the
D-pad works from the first press, Back opens the pause menu, the pause menu works with arrows and OK, and Back in the
lobby closes the app. Not yet tried on the TCL itself: frame rates, and how its remote's extra buttons behave.
