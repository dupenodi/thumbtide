# Windows firewall rule that lets phones on the home network reach the Thumbtide dev servers.
#   powershell -ExecutionPolicy Bypass -File tools\lan-firewall.ps1           # add (or refresh) the rule
#   powershell -ExecutionPolicy Bypass -File tools\lan-firewall.ps1 -Remove   # take it away
#   powershell -ExecutionPolicy Bypass -File tools\lan-firewall.ps1 -Status   # show it
# It allows TCP on the dev ports from the local subnet only (not from the internet), whichever node.exe runs the
# servers. Windows asks for administrator rights (a UAC prompt) when the script is not elevated.
param([switch]$Remove, [switch]$Status)

$name = "Thumbtide dev (LAN)"
# Vite 5173/5174/5180, relays 8787/8788, LAN probe 8796
$ports = @(5173, 5174, 5180, 8787, 8788, 8796)

function Show-Rule {
  $r = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
  if (-not $r) { "Rule '$name': not present"; return }
  $p = $r | Get-NetFirewallPortFilter
  $a = $r | Get-NetFirewallAddressFilter
  "Rule '$name': enabled $($r.Enabled), profiles $($r.Profile), TCP ports $($p.LocalPort -join ','), from $($a.RemoteAddress -join ',')"
}

if ($Status) { Show-Rule; return }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  # run this script again elevated, with the same switch, and wait for it
  $args2 = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
  if ($Remove) { $args2 += "-Remove" }
  $p = Start-Process powershell -Verb RunAs -ArgumentList $args2 -Wait -PassThru
  "Elevated run finished (exit $($p.ExitCode))."
  Show-Rule
  return
}

Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Remove) {
  "Removed '$name'."
} else {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ports -RemoteAddress LocalSubnet -Profile Private, Public | Out-Null
  "Added '$name'."
}
Show-Rule
