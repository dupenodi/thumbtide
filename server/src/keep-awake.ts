/**
 * Keep a Windows PC from going to sleep while the relay runs: a sleeping PC ends every room.
 *
 * A hidden PowerShell child calls kernel32 SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) and then
 * waits for this process to exit. Windows drops the request when that thread ends, so the PC can sleep again as
 * soon as the relay stops, also when it is killed (`tsx watch` restarts, Task Manager) and no exit handler runs.
 * Only system sleep is blocked; the display can still turn off. No admin rights needed.
 *
 * No-op on other platforms. Turn it off with THUMBTIDE_KEEP_AWAKE=0.
 */
import { spawn, type ChildProcess } from "node:child_process";

export function keepAwakeDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(0|false|no|off)$/i.test((env.THUMBTIDE_KEEP_AWAKE ?? "").trim());
}

/** The PowerShell script; the constants stay in C# (0x80000001 is a negative Int32 in PowerShell). */
export function keepAwakeScript(pid: number): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Thumbtide -Name KeepAwake -MemberDefinition @'
[DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint flags);
public static void Hold(int pid) {
  // ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x1), on this thread, which then waits
  if (SetThreadExecutionState(0x80000001u) == 0) throw new System.ComponentModel.Win32Exception();
  try { System.Diagnostics.Process.GetProcessById(pid).WaitForExit(); } catch (System.ArgumentException) { }
}
'@
[Thumbtide.KeepAwake]::Hold(${Math.floor(pid)})
`;
}

/** Start the keep-awake helper. Returns a stop function, or null when it does not apply. */
export function keepAwake(log: (line: string) => void = console.log): (() => void) | null {
  if (process.platform !== "win32" || keepAwakeDisabled()) return null;
  let child: ChildProcess;
  try {
    child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand",
        Buffer.from(keepAwakeScript(process.pid), "utf16le").toString("base64")],
      { windowsHide: true, stdio: "ignore" },
    );
  } catch {
    return null;
  }
  child.on("error", (e) => log(`[thumbtide] could not keep this PC awake: ${e.message}`));
  child.unref(); // never hold the relay open
  log("[thumbtide] keeping this PC awake while the relay runs (set THUMBTIDE_KEEP_AWAKE=0 to allow sleep)");
  return () => {
    if (child.exitCode === null) child.kill();
  };
}
