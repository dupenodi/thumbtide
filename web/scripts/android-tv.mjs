#!/usr/bin/env node
// Packages the TV page as an Android TV app (an .apk) and puts it on the TV.
//
//   pnpm tv:android --tv=192.168.0.50     build, install on that TV over Wi-Fi and open it
//   pnpm tv:android                       the same, on the TV adb is already connected to
//   pnpm tv:android --build               only build web/dist-android/thumbtide.apk
//   pnpm tv:android --params="game=cascade&bots=3"   open straight into a game (any ?name= option of the TV page)
//   pnpm tv:android --release             without chrome://inspect (development builds have it on)
//
// Like the LG app (scripts/tv.mjs), the app holds the TV page only. It connects to the relay on this computer
// (`pnpm dev`, at its LAN address) and the QR code sends phones here too. Rebuild when this computer's IP changes.
// For a deployed relay, set VITE_RELAY_URL (wss://…) and VITE_JOIN_URL (https://…/join/).
//
// Needs the Android SDK (Android Studio installs it; ANDROID_HOME, or ~/Library/Android/sdk) and Java 11+ (JAVA_HOME,
// or the one inside Android Studio). No Gradle: the few build steps run the SDK's own tools. See docs/android-tv.md.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildTvPage } from "./lib/tv-build.mjs";
import { fail, lanIp, web } from "./lib/webos.mjs";

const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const src = join(web, "tv/android");
const out = join(web, "dist-android");
const apk = join(out, "thumbtide.apk");
const PKG = "com.thumbtide.tv";
const version = JSON.parse(readFileSync(join(web, "package.json"), "utf8")).version;
// versionCode must grow with every install that should replace the last: 0.1.0 → 1000, 1.2.3 → 1002003
const versionCode = version.split(".").reduce((n, p) => n * 1000 + Number.parseInt(p, 10), 0) || 1;

// ------------------------------------------------------------------ tools
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(homedir(), "Library/Android/sdk"), join(homedir(), "Android/Sdk")].find(
  (d) => d && existsSync(join(d, "platform-tools")),
);
if (!sdk) fail("No Android SDK found. Install Android Studio (it brings the SDK), or set ANDROID_HOME.");
const newest = (dir, re) =>
  readdirSync(dir)
    .filter((d) => re.test(d))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .pop();
const buildTools = join(sdk, "build-tools", newest(join(sdk, "build-tools"), /^\d/) ?? fail("No Android build-tools in the SDK."));
const platform = newest(join(sdk, "platforms"), /^android-\d+$/) ?? fail("No Android platform in the SDK (Android Studio → SDK Manager).");
const androidJar = join(sdk, "platforms", platform, "android.jar");
const javaHome = [process.env.JAVA_HOME, "/Applications/Android Studio.app/Contents/jbr/Contents/Home"].find((d) => d && existsSync(join(d, "bin/java")));
const tool = {
  aapt2: join(buildTools, "aapt2"),
  d8: join(buildTools, "d8"),
  zipalign: join(buildTools, "zipalign"),
  apksigner: join(buildTools, "apksigner"),
  adb: join(sdk, "platform-tools/adb"),
  javac: javaHome ? join(javaHome, "bin/javac") : "javac",
  keytool: javaHome ? join(javaHome, "bin/keytool") : "keytool",
};
const env = { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome, PATH: `${join(javaHome, "bin")}:${process.env.PATH}` } : {}) };

function sh(cmd, a, { quiet = false } = {}) {
  const r = spawnSync(cmd, a, { env, encoding: "utf8", maxBuffer: 64 << 20 });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.error || r.status !== 0) fail(`${cmd.split("/").pop()} failed:\n${r.error?.message ?? text}`);
  if (!quiet && text) console.log(text);
  return text;
}
const adbOut = (...a) => spawnSync(tool.adb, a, { encoding: "utf8" });

// ------------------------------------------------------------------ the TV page
const ip = process.env.VITE_RELAY_URL && process.env.VITE_JOIN_URL ? null : lanIp(opt("tv")?.split(":")[0]);
const pageEnv = {
  VITE_RELAY_URL: process.env.VITE_RELAY_URL || `ws://${ip}:8787`,
  VITE_JOIN_URL: process.env.VITE_JOIN_URL || `http://${ip}:5173/join/`,
};
console.log(`Building the Android TV app ${version}\n  relay  ${pageEnv.VITE_RELAY_URL}\n  phones ${pageEnv.VITE_JOIN_URL}\n`);
rmSync(out, { recursive: true, force: true });
if (!buildTvPage(web, { outDir: "dist-android/assets", env: pageEnv, quiet: true })) fail("Build failed.");

// ------------------------------------------------------------------ the app
const gen = join(out, "gen");
const classes = join(out, "classes");
mkdirSync(gen, { recursive: true });
mkdirSync(classes, { recursive: true });
mkdirSync(join(gen, "com/thumbtide/tv"), { recursive: true });
writeFileSync(
  join(gen, "com/thumbtide/tv/BuildConfig.java"),
  `package com.thumbtide.tv;\n\n/** Written by scripts/android-tv.mjs. */\nfinal class BuildConfig {\n  static final String VERSION = "${version}";\n  static final boolean DEBUG = ${!args.includes("--release")};\n}\n`,
);

sh(tool.aapt2, ["compile", "--dir", join(src, "res"), "-o", join(out, "res.zip")], { quiet: true });
sh(
  tool.aapt2,
  [
    "link", "-o", join(out, "unsigned.apk"), "-I", androidJar,
    "--manifest", join(src, "AndroidManifest.xml"),
    "--java", gen,
    "--min-sdk-version", "24", "--target-sdk-version", "35",
    "--version-code", String(versionCode), "--version-name", version,
    "-A", join(out, "assets"),
    "--no-compress-regex", "\\.(ogg|mp3|webp|png|jpg|woff2)$",
    join(out, "res.zip"),
  ],
  { quiet: true },
);
const javaFiles = [];
const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".java") && javaFiles.push(join(d, e.name))));
walk(join(src, "java"));
walk(gen);
sh(tool.javac, ["--release", "11", "-nowarn", "-encoding", "UTF-8", "-classpath", androidJar, "-d", classes, ...javaFiles], { quiet: true });
const classFiles = [];
const walkClasses = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walkClasses(join(d, e.name)) : e.name.endsWith(".class") && classFiles.push(join(d, e.name))));
walkClasses(classes);
sh(tool.d8, ["--min-api", "24", "--lib", androidJar, "--output", out, ...classFiles], { quiet: true });

// add classes.dex to the package: copy it and append with zip, so it sits at the root of the .apk
cpSync(join(out, "unsigned.apk"), join(out, "with-dex.apk"));
const zip = spawnSync("zip", ["-q", "-j", join(out, "with-dex.apk"), join(out, "classes.dex")]);
if (zip.status !== 0) fail("zip failed (it adds the code to the package).");
sh(tool.zipalign, ["-f", "-p", "4", join(out, "with-dex.apk"), join(out, "aligned.apk")], { quiet: true });

// sign with the debug key Android Studio uses (made here if there isn't one)
const keystore = join(homedir(), ".android/debug.keystore");
if (!existsSync(keystore)) {
  mkdirSync(join(homedir(), ".android"), { recursive: true });
  sh(tool.keytool, ["-genkeypair", "-keystore", keystore, "-storepass", "android", "-alias", "androiddebugkey", "-keypass", "android", "-keyalg", "RSA", "-validity", "10000", "-dname", "CN=Android Debug,O=Android,C=US"], { quiet: true });
}
sh(tool.apksigner, ["sign", "--v4-signing-enabled", "false", "--ks", keystore, "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", apk, join(out, "aligned.apk")], { quiet: true });
for (const f of ["unsigned.apk", "with-dex.apk", "aligned.apk", "res.zip", "classes.dex", "apk.idsig"]) rmSync(join(out, f), { force: true });
rmSync(classes, { recursive: true, force: true });
console.log(`App: ${apk}`);
if (args.includes("--build")) process.exit(0);

// ------------------------------------------------------------------ install + open
const tv = opt("tv") ?? process.env.ANDROID_TV;
let serial = null;
if (tv) {
  serial = tv.includes(":") ? tv : `${tv}:5555`;
  const r = adbOut("connect", serial);
  const said = `${r.stdout}${r.stderr}`.trim();
  if (!/connected to/.test(said)) {
    fail(`Couldn't reach the TV at ${serial}: ${said}\nOn the TV, turn on Developer options → USB debugging (see docs/android-tv.md). The first time, the TV asks to allow this computer: pick Always allow, then run this again.`);
  }
} else {
  const devices = adbOut("devices").stdout.split("\n").slice(1).filter((l) => /\tdevice$/.test(l)).map((l) => l.split("\t")[0]);
  if (devices.length === 0) fail("No TV connected. Run it with the TV's address: pnpm tv:android --tv=<TV IP>");
  if (devices.length > 1) fail(`Several devices are connected (${devices.join(", ")}). Pick one: pnpm tv:android --tv=<TV IP>`);
  serial = devices[0];
}
const state = adbOut("-s", serial, "get-state").stdout.trim();
if (state !== "device") fail(`The TV at ${serial} is "${state || "not answering"}". If it says unauthorized, accept the prompt on the TV (Always allow), then run this again.`);
const model = adbOut("-s", serial, "shell", "getprop", "ro.product.model").stdout.trim();
const androidVersion = adbOut("-s", serial, "shell", "getprop", "ro.build.version.release").stdout.trim();
console.log(`TV: ${model || "Android TV"}, Android ${androidVersion || "?"} (${serial})`);

let install = adbOut("-s", serial, "install", "-r", apk);
if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/.test(`${install.stdout}${install.stderr}`)) {
  console.log("An older Thumbtide signed with another key is installed. Replacing it.");
  adbOut("-s", serial, "uninstall", PKG);
  install = adbOut("-s", serial, "install", apk);
}
if (install.status !== 0 || !/Success/.test(install.stdout)) fail(`Install failed:\n${install.stdout}${install.stderr}`);

const params = opt("params");
adbOut("-s", serial, "shell", "am", "force-stop", PKG);
const launch = adbOut("-s", serial, "shell", "am", "start", "-n", `${PKG}/.MainActivity`, ...(params ? ["--es", "params", `'${params}'`] : []));
if (launch.status !== 0 || /Error/.test(launch.stdout)) fail(`Installed, but it didn't open. Find Thumbtide in the TV's apps.\n${launch.stdout}${launch.stderr}`);

const listening = (port) =>
  new Promise((res) => {
    const s = connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });
if (ip && !((await listening(8787)) && (await listening(5173)))) {
  console.warn("\nThumbtide is open on the TV, but the dev servers aren't running here. Start them with: pnpm dev");
} else {
  console.log("\nThumbtide is open on the TV.");
}
