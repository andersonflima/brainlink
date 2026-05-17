import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { platform, tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import type { Command } from 'commander'
import { addNoteWithMetadata } from '../../application/add-note.js'
import { buildContextPackage } from '../../application/build-context.js'
import { resolveDuplicateNotes, scanDuplicateNotes } from '../../application/dedupe-notes.js'
import { importLegacySqliteDatabase } from '../../application/import-legacy-sqlite.js'
import type { IndexVaultProgressEvent, IndexVaultResult } from '../../application/index-vault.js'
import { indexVault, indexVaultWithOptions } from '../../application/index-vault.js'
import { migrateVaultContent, planVaultMigration, previewVaultMigration, shouldMigrateDefaultVault } from '../../application/migrate-vault.js'
import { createOfflinePackBackup } from '../../application/offline-pack-backup.js'
import { startServer } from '../../application/start-server.js'
import { startVaultWatcher } from '../../application/watch-vault.js'
import { doctorVault, getStats, validateVault } from '../../application/analyze-vault.js'
import { defaultBrainlinkConfig, sanitizeSearchMode } from '../../infrastructure/config.js'
import { loadBrainlinkConfig } from '../../infrastructure/config.js'
import { assertVaultAllowed, ensureVault } from '../../infrastructure/file-system-vault.js'
import { getBootstrapPolicy, getBootstrapSessionStatus, touchBootstrapSession } from '../../infrastructure/session-state.js'
import { installAgentIntegration } from './agent-commands.js'
import { parsePositiveInteger, print, resolveOptions } from '../runtime.js'
import type {
  AddOptions,
  BenchOptions,
  DbImportOptions,
  DedupeOptions,
  DedupeResolveOptions,
  InitOptions,
  PackBackupOptions,
  MigrateVaultOptions,
  QuickstartOptions,
  ServerOptions,
  VaultOptions
} from '../types.js'

const resolveAddContent = (options: AddOptions): string => {
  if (options.content != null && options.content.trim().length > 0) {
    return options.content
  }

  if (options.contentFile == null || options.contentFile.trim().length === 0) {
    throw new Error('Use --content or --content-file to provide note content.')
  }

  return readFileSync(options.contentFile, 'utf8')
}

const parseScore = (value: string | undefined, fallback: number): number => {
  if (value == null) {
    return fallback
  }

  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid score value: ${value}. Expected a number between 0 and 1.`)
  }

  return parsed
}

const formatBytes = (bytes: number | undefined): string => {
  if (!Number.isFinite(bytes) || bytes == null) {
    return 'n/a'
  }
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

const formatMs = (value: number | undefined): string =>
  Number.isFinite(value) && value != null ? `${value.toFixed(value >= 100 ? 0 : 1)}ms` : 'n/a'

const benchEventLabel = (event: IndexVaultProgressEvent): string =>
  `${event.phase}:${event.status}`

const printBenchRealtimeEvent = (json: boolean | undefined, event: IndexVaultProgressEvent): void => {
  print(
    json,
    {
      event: 'bench-progress',
      ...event
    },
    () => `[bench] ${benchEventLabel(event)} ${event.message} (${formatMs(event.elapsedMs)})`
  )
}

const printBenchSummary = (
  json: boolean | undefined,
  trigger: 'manual' | 'watch',
  vault: string,
  result: IndexVaultResult
): void => {
  print(
    json,
    {
      event: 'bench-result',
      trigger,
      vault,
      result
    },
    () => {
      const packs = result.packs
      const compression = packs?.compression
      const savedPercent =
        compression && compression.inputBytes > 0
          ? `${((1 - compression.ratio) * 100).toFixed(1)}%`
          : 'n/a'

      return [
        `[bench] trigger=${trigger}`,
        `documents=${result.documentCount} chunks=${result.chunkCount} links=${result.linkCount}`,
        `changedDocuments=${result.changedDocumentCount ?? 0} totalElapsed=${formatMs(result.elapsedMs)}`,
        `packsRebuilt=${packs?.rebuilt ? 'yes' : 'no'} reason=${packs?.reason ?? 'n/a'}`,
        packs?.rebuilt
          ? `packCount=${packs.packCount ?? 0} packDuration=${formatMs(packs.durationMs)} input=${formatBytes(compression?.inputBytes)} output=${formatBytes(compression?.outputBytes)} saved=${savedPercent}`
          : 'packCompression=n/a'
      ].join('\n')
    }
  )
}

type BenchHistoryEntry = {
  readonly elapsedMs: number
  readonly compressionRatio?: number
  readonly timestamp: string
}

type BenchGuardrailResult = {
  readonly compressionSavingsPercent?: number
  readonly compressionPass?: boolean
  readonly latencyRegressionPercent?: number
  readonly latencyPass?: boolean
}

const benchHistoryPath = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', 'benchmarks', 'latest.json')

const readBenchHistory = async (vaultPath: string): Promise<BenchHistoryEntry | null> => {
  try {
    const parsed = JSON.parse(await readFile(benchHistoryPath(vaultPath), 'utf8')) as Partial<BenchHistoryEntry>
    if (typeof parsed.elapsedMs !== 'number' || typeof parsed.timestamp !== 'string') {
      return null
    }

    return {
      elapsedMs: parsed.elapsedMs,
      timestamp: parsed.timestamp,
      ...(typeof parsed.compressionRatio === 'number' ? { compressionRatio: parsed.compressionRatio } : {})
    }
  } catch {
    return null
  }
}

const writeBenchHistory = async (vaultPath: string, result: IndexVaultResult): Promise<void> => {
  await mkdir(dirname(benchHistoryPath(vaultPath)), { recursive: true })
  const payload: BenchHistoryEntry = {
    elapsedMs: result.elapsedMs ?? 0,
    timestamp: new Date().toISOString(),
    ...(typeof result.packs?.compression?.ratio === 'number' ? { compressionRatio: result.packs.compression.ratio } : {})
  }
  await writeFile(benchHistoryPath(vaultPath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

const evaluateBenchGuardrails = (
  config: Awaited<ReturnType<typeof loadBrainlinkConfig>>,
  result: IndexVaultResult,
  baseline: BenchHistoryEntry | null
): BenchGuardrailResult => {
  const compressionRatio = result.packs?.compression?.ratio
  const compressionSavingsPercent =
    typeof compressionRatio === 'number' ? Math.max(0, (1 - compressionRatio) * 100) : undefined
  const compressionPass =
    compressionSavingsPercent != null
      ? compressionSavingsPercent >= config.searchPack.guardrailMinSavingsPercent
      : undefined
  const latencyRegressionPercent =
    baseline && baseline.elapsedMs > 0 && typeof result.elapsedMs === 'number'
      ? ((result.elapsedMs - baseline.elapsedMs) / baseline.elapsedMs) * 100
      : undefined
  const latencyPass =
    latencyRegressionPercent != null
      ? latencyRegressionPercent <= config.searchPack.guardrailMaxLatencyRegressionPercent
      : undefined

  return {
    ...(compressionSavingsPercent != null ? { compressionSavingsPercent } : {}),
    ...(compressionPass != null ? { compressionPass } : {}),
    ...(latencyRegressionPercent != null ? { latencyRegressionPercent } : {}),
    ...(latencyPass != null ? { latencyPass } : {})
  }
}

const printBenchGuardrails = (
  json: boolean | undefined,
  vault: string,
  config: Awaited<ReturnType<typeof loadBrainlinkConfig>>,
  guardrails: BenchGuardrailResult
): void => {
  print(
    json,
    {
      event: 'bench-guardrails',
      vault,
      thresholds: {
        minSavingsPercent: config.searchPack.guardrailMinSavingsPercent,
        maxLatencyRegressionPercent: config.searchPack.guardrailMaxLatencyRegressionPercent
      },
      guardrails
    },
    () => {
      const savings = guardrails.compressionSavingsPercent
      const latency = guardrails.latencyRegressionPercent
      return [
        '[bench] guardrails',
        `minSavings=${config.searchPack.guardrailMinSavingsPercent.toFixed(1)}% maxLatencyRegression=${config.searchPack.guardrailMaxLatencyRegressionPercent.toFixed(1)}%`,
        `compressionSavings=${savings != null ? `${savings.toFixed(2)}%` : 'n/a'} pass=${guardrails.compressionPass != null ? (guardrails.compressionPass ? 'yes' : 'no') : 'n/a'}`,
        `latencyRegression=${latency != null ? `${latency.toFixed(2)}%` : 'n/a'} pass=${guardrails.latencyPass != null ? (guardrails.latencyPass ? 'yes' : 'no') : 'n/a'}`
      ].join('\n')
    }
  )
}

const spawnDetached = (command: string, args: readonly string[], envOverrides?: NodeJS.ProcessEnv): boolean => {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env: envOverrides ? { ...process.env, ...envOverrides } : process.env
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

const nativeGuiSwiftScriptPath = join(tmpdir(), 'brainlink-native-gui.swift')
const nativeGuiPowershellScriptPath = join(tmpdir(), 'brainlink-native-gui.ps1')
const nativeGuiLinuxScriptPath = join(tmpdir(), 'brainlink-native-gui-linux.py')

const nativeGuiSwiftScript = `import Foundation
import AppKit
import WebKit
import Darwin

final class BrainlinkAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  private let targetUrl: URL
  private let parentPid: Int32
  private var window: NSWindow?
  private var webView: WKWebView?
  private var monitorTimer: Timer?

  init(targetUrl: URL, parentPid: Int32) {
    self.targetUrl = targetUrl
    self.parentPid = parentPid
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Brainlink Graph"
    window.center()
    window.isReleasedWhenClosed = false
    window.delegate = self

    let webView = WKWebView(frame: window.contentView?.bounds ?? .zero)
    webView.autoresizingMask = [.width, .height]
    webView.allowsBackForwardNavigationGestures = true
    webView.load(URLRequest(url: targetUrl))
    window.contentView?.addSubview(webView)

    self.window = window
    self.webView = webView

    if parentPid > 0 {
      monitorTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
        if kill(self.parentPid, 0) != 0 {
          NSApp.terminate(nil)
        }
      }
    }

    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func windowWillClose(_ notification: Notification) {
    monitorTimer?.invalidate()
    NSApp.terminate(nil)
  }
}

let args = Array(CommandLine.arguments.dropFirst())
let rawTarget = args.indices.contains(0) ? args[0] : "http://127.0.0.1:4321"
let parentPid: Int32 = args.indices.contains(1) ? (Int32(args[1]) ?? 0) : 0

guard let targetUrl = URL(string: rawTarget) else {
  fputs("Invalid URL for Brainlink GUI: \\(rawTarget)\\n", stderr)
  exit(1)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = BrainlinkAppDelegate(targetUrl: targetUrl, parentPid: parentPid)
app.delegate = delegate
app.run()
`

const nativeGuiPowershellScript = `param(
  [string]$TargetUrl = "http://127.0.0.1:4321",
  [int]$ParentPid = 0
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Brainlink Graph"
$form.Width = 1320
$form.Height = 860
$form.StartPosition = "CenterScreen"

$browser = New-Object System.Windows.Forms.WebBrowser
$browser.Dock = [System.Windows.Forms.DockStyle]::Fill
$browser.ScriptErrorsSuppressed = $true
$browser.Navigate($TargetUrl)

$form.Controls.Add($browser)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
  if ($ParentPid -le 0) {
    return
  }
  try {
    Get-Process -Id $ParentPid -ErrorAction Stop | Out-Null
  } catch {
    $timer.Stop()
    $form.Close()
  }
})
$form.Add_FormClosed({
  $timer.Stop()
})
$timer.Start()
[void]$form.ShowDialog()
`

const nativeGuiLinuxPythonScript = `#!/usr/bin/env python3
import sys

def run() -> int:
    try:
        import gi
        gi.require_version("Gtk", "3.0")
        try:
            gi.require_version("WebKit2", "4.1")
        except ValueError:
            gi.require_version("WebKit2", "4.0")
        from gi.repository import Gtk, WebKit2, GLib
    except Exception:
        return 1

    target_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4321"
    parent_pid = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    window = Gtk.Window(title="Brainlink Graph")
    window.set_default_size(1320, 860)
    window.connect("destroy", Gtk.main_quit)

    webview = WebKit2.WebView()
    webview.load_uri(target_url)
    window.add(webview)
    window.show_all()

    if parent_pid > 0:
        def _watch_parent() -> bool:
            try:
                import os
                os.kill(parent_pid, 0)
            except Exception:
                Gtk.main_quit()
                return False
            return True

        GLib.timeout_add(1000, _watch_parent)

    Gtk.main()
    return 0

if __name__ == "__main__":
    raise SystemExit(run())
`

const commandExists = (command: string): boolean => {
  try {
    const probe = platform() === 'win32'
      ? spawnSync('where', [command], { stdio: 'ignore' })
      : spawnSync('which', [command], { stdio: 'ignore' })
    return probe.status === 0
  } catch {
    return false
  }
}

const readLinuxDefaultBrowserDesktopEntry = (): string | null => {
  try {
    const preferred = spawnSync('xdg-settings', ['get', 'default-web-browser'], { encoding: 'utf8' })
    const rawPreferred = preferred.status === 0 ? preferred.stdout.trim() : ''
    if (rawPreferred.length > 0) {
      return rawPreferred
    }
  } catch {
    // fallback below
  }

  try {
    const fallback = spawnSync('xdg-mime', ['query', 'default', 'x-scheme-handler/https'], { encoding: 'utf8' })
    const rawFallback = fallback.status === 0 ? fallback.stdout.trim() : ''
    return rawFallback.length > 0 ? rawFallback : null
  } catch {
    return null
  }
}

const toLinuxDefaultBrowserCommands = (desktopEntry: string | null): readonly string[] => {
  if (!desktopEntry) {
    return []
  }

  const normalized = desktopEntry.toLowerCase().trim()
  if (normalized.includes('firefox')) {
    return ['firefox']
  }
  if (normalized.includes('edge')) {
    return ['microsoft-edge', 'microsoft-edge-stable']
  }
  if (normalized.includes('brave')) {
    return ['brave-browser']
  }
  if (normalized.includes('chromium')) {
    return ['chromium', 'chromium-browser']
  }
  if (normalized.includes('chrome')) {
    return ['google-chrome', 'google-chrome-stable']
  }

  return []
}

const readBrowserEnvCommands = (): readonly string[] => {
  const value = process.env.BROWSER?.trim()
  if (!value) {
    return []
  }

  return value
    .split(':')
    .map((entry) => entry.trim().split(/\s+/)[0] ?? '')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

const prioritizeLinuxBrowserCandidates = <T extends readonly [string, ...unknown[]]>(
  candidates: readonly T[]
): readonly T[] => {
  const preferredCommands = toLinuxDefaultBrowserCommands(readLinuxDefaultBrowserDesktopEntry())
  if (preferredCommands.length === 0) {
    return candidates
  }

  const priorityMap = new Map(preferredCommands.map((command, index) => [command, index]))

  return [...candidates].sort((left, right) => {
    const leftPriority = priorityMap.get(left[0] as string)
    const rightPriority = priorityMap.get(right[0] as string)
    const leftScore = leftPriority == null ? Number.POSITIVE_INFINITY : leftPriority
    const rightScore = rightPriority == null ? Number.POSITIVE_INFINITY : rightPriority
    return leftScore - rightScore
  })
}

const envFlagEnabled = (name: string): boolean =>
  process.env[name] === '1' || process.env[name] === 'true'

const spawnAnyDetached = (candidates: readonly (readonly [string, readonly string[]])[]): boolean =>
  candidates.some(([command, args]) => spawnDetached(command, args))

const spawnAnyDetachedWithEnv = (
  candidates: readonly (readonly [string, readonly string[], NodeJS.ProcessEnv | undefined])[]
): boolean => candidates.some(([command, args, env]) => spawnDetached(command, args, env))

const windowsStartCandidates = (program: string, args: readonly string[] = []): readonly [string, readonly string[]][] => [
  ['cmd', ['/c', 'start', '', program, ...args]]
]

const resolveSwiftExecutable = (): string | null => {
  const directSwift = '/usr/bin/swift'
  if (existsSync(directSwift)) {
    return directSwift
  }

  try {
    const probe = spawnSync('xcrun', ['--find', 'swift'], { encoding: 'utf8' })
    const swiftPath = probe.status === 0 ? probe.stdout.trim() : ''
    return swiftPath.length > 0 ? swiftPath : null
  } catch {
    return null
  }
}

const openGraphInMacNativeGui = (url: string, parentPid: number): boolean => {
  const swiftBinary = resolveSwiftExecutable()
  if (!swiftBinary) {
    return false
  }

  try {
    writeFileSync(nativeGuiSwiftScriptPath, nativeGuiSwiftScript, 'utf8')
  } catch {
    return false
  }

  return spawnDetached(swiftBinary, [nativeGuiSwiftScriptPath, url, String(parentPid)])
}

const resolveWindowsPowershellExecutable = (): string | null => {
  if (commandExists('powershell')) {
    return 'powershell'
  }

  if (commandExists('pwsh')) {
    return 'pwsh'
  }

  return null
}

const openGraphInWindowsNativeGui = (url: string, parentPid: number): boolean => {
  const powershell = resolveWindowsPowershellExecutable()
  if (!powershell) {
    return false
  }

  try {
    writeFileSync(nativeGuiPowershellScriptPath, nativeGuiPowershellScript, 'utf8')
  } catch {
    return false
  }

  return spawnDetached(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', nativeGuiPowershellScriptPath, url, String(parentPid)])
}

const openGraphInLinuxNativeGui = (url: string, parentPid: number): boolean => {
  if (!commandExists('python3')) {
    return false
  }

  try {
    writeFileSync(nativeGuiLinuxScriptPath, nativeGuiLinuxPythonScript, 'utf8')
  } catch {
    return false
  }

  return spawnDetached('python3', [nativeGuiLinuxScriptPath, url, String(parentPid)])
}

const openGraphInNativeGui = (url: string, parentPid: number): boolean => {
  if (platform() === 'darwin') {
    return openGraphInMacNativeGui(url, parentPid)
  }

  if (platform() === 'win32') {
    return openGraphInWindowsNativeGui(url, parentPid)
  }

  return openGraphInLinuxNativeGui(url, parentPid)
}

const openGraphInAppWindow = (url: string): boolean => {
  if (platform() === 'darwin') {
    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ]
      .filter((candidate) => existsSync(candidate))
      .map((binary) => ({ binary, args: [`--app=${url}`, '--new-window'] as const }))

    for (const candidate of macCandidates) {
      if (spawnDetached(candidate.binary, candidate.args)) {
        return true
      }
    }

    return false
  }

  if (platform() === 'win32') {
    const appArgument = `--app=${url}`
    return spawnAnyDetached([
      ...windowsStartCandidates('msedge', [appArgument, '--new-window']),
      ...windowsStartCandidates('chrome', [appArgument, '--new-window']),
      ...windowsStartCandidates('chromium', [appArgument, '--new-window']),
      ...windowsStartCandidates('brave', [appArgument, '--new-window'])
    ])
  }

  const appArgument = `--app=${url}`
  const linuxAppWindowEnabled = envFlagEnabled('BRAINLINK_LINUX_APP_WINDOW')
  if (!linuxAppWindowEnabled) {
    return false
  }
  const linuxChromiumStableFlags = [
    '--ozone-platform=x11',
    '--ozone-platform-hint=x11',
    '--disable-gpu',
    '--disable-vulkan',
    '--use-gl=swiftshader',
    '--disable-features=Vulkan,VaapiVideoDecoder',
    '--disable-background-networking'
  ] as const
  const linuxChromiumEnv: NodeJS.ProcessEnv = {
    GDK_BACKEND: 'x11',
    OZONE_PLATFORM: 'x11'
  }
  const linuxAppWindowCandidates = [
    'microsoft-edge',
    'microsoft-edge-stable',
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    'brave-browser'
  ].filter((candidate) => commandExists(candidate))

  return spawnAnyDetachedWithEnv(
    linuxAppWindowCandidates.map((command) => [
      command,
      [...linuxChromiumStableFlags, appArgument, '--new-window'],
      linuxChromiumEnv
    ] as const)
  )
}

const openGraphInDetectedBrowser = (url: string): boolean => {
  if (platform() === 'win32') {
    return spawnAnyDetached([
      ...windowsStartCandidates('msedge', [url]),
      ...windowsStartCandidates('chrome', [url]),
      ...windowsStartCandidates('firefox', ['-new-window', url]),
      ...windowsStartCandidates('chromium', [url]),
      ...windowsStartCandidates('brave', [url])
    ])
  }

  const linuxChromiumStableFlags = [
    '--ozone-platform=x11',
    '--ozone-platform-hint=x11',
    '--disable-gpu',
    '--disable-vulkan',
    '--use-gl=swiftshader',
    '--disable-features=Vulkan,VaapiVideoDecoder',
    '--disable-background-networking'
  ] as const
  const linuxChromiumEnv: NodeJS.ProcessEnv = {
    GDK_BACKEND: 'x11',
    OZONE_PLATFORM: 'x11'
  }
  const envBrowserCandidates = readBrowserEnvCommands()
    .map((command) =>
      command.includes('firefox')
        ? ([command, ['-new-window', url], undefined] as const)
        : ([command, [url], undefined] as const)
    )
    .filter(([command]) => commandExists(command))

  if (envBrowserCandidates.length > 0 && spawnAnyDetachedWithEnv(envBrowserCandidates)) {
    return true
  }

  const linuxBrowserCandidates: readonly (readonly [string, readonly string[], NodeJS.ProcessEnv | undefined])[] = [
    ['firefox', ['-new-window', url], undefined],
    ['microsoft-edge', [...linuxChromiumStableFlags, url], linuxChromiumEnv],
    ['microsoft-edge-stable', [...linuxChromiumStableFlags, url], linuxChromiumEnv],
    ['google-chrome', [...linuxChromiumStableFlags, url], linuxChromiumEnv],
    ['google-chrome-stable', [...linuxChromiumStableFlags, url], linuxChromiumEnv],
    ['brave-browser', [...linuxChromiumStableFlags, url], linuxChromiumEnv],
    ['chromium', [...linuxChromiumStableFlags, url], linuxChromiumEnv],
    ['chromium-browser', [...linuxChromiumStableFlags, url], linuxChromiumEnv]
  ]

  const available = prioritizeLinuxBrowserCandidates(linuxBrowserCandidates.filter(([command]) => commandExists(command)))
  return spawnAnyDetachedWithEnv(available)
}

const openUrlInUi = (url: string, parentPid: number): { readonly opened: boolean; readonly mode: 'native-gui' | 'app-window' | 'browser' | 'none' } => {
  const openDisabled =
    process.env.BRAINLINK_NO_BROWSER === '1' ||
    process.env.BRAINLINK_NO_BROWSER === 'true' ||
    process.env.CI === 'true'

  if (openDisabled) {
    return { opened: false, mode: 'none' }
  }

  const currentPlatform = platform()
  const nativeGuiEnabled =
    !envFlagEnabled('BRAINLINK_NO_NATIVE_GUI') &&
    (currentPlatform !== 'linux' || envFlagEnabled('BRAINLINK_LINUX_NATIVE_GUI') || envFlagEnabled('BRAINLINK_FORCE_NATIVE_GUI'))

  if (nativeGuiEnabled && openGraphInNativeGui(url, parentPid)) {
    return { opened: true, mode: 'native-gui' }
  }

  if (platform() === 'linux') {
    if (spawnDetached('xdg-open', [url])) {
      return { opened: true, mode: 'browser' }
    }

    if (openGraphInDetectedBrowser(url)) {
      return { opened: true, mode: 'browser' }
    }

    if (openGraphInAppWindow(url)) {
      return { opened: true, mode: 'app-window' }
    }

    return { opened: false, mode: 'none' }
  }

  if (openGraphInAppWindow(url)) {
    return { opened: true, mode: 'app-window' }
  }

  try {
    if (platform() === 'darwin') {
      return { opened: spawnDetached('open', [url]), mode: 'browser' }
    }

    if (openGraphInDetectedBrowser(url)) {
      return { opened: true, mode: 'browser' }
    }

    if (platform() === 'win32') {
      return { opened: spawnDetached('cmd', ['/c', 'start', '', url]), mode: 'browser' }
    }

    return { opened: spawnDetached('xdg-open', [url]), mode: 'browser' }
  } catch {
    return { opened: false, mode: 'none' }
  }
}

export const registerWriteCommands = (program: Command): void => {
  program
    .command('init')
  .argument('[vault]', 'vault directory')
  .option('--migrate-from <vault>', 'copy existing vault content into the initialized vault')
  .option('--no-migrate-existing', 'skip automatic migration from the default Brainlink vault into an empty custom vault')
  .option('--json', 'print machine-readable JSON')
  .description('initialize a Brainlink vault')
  .action(async (vault: string | undefined, options: InitOptions) => {
    const config = await loadBrainlinkConfig()
    const targetVault = assertVaultAllowed(vault ?? config.vault, config.allowedVaults)
    const path = await ensureVault(targetVault)
    const explicitSource = options.migrateFrom ? assertVaultAllowed(options.migrateFrom, config.allowedVaults) : undefined
    const shouldAutoMigrate =
      explicitSource === undefined &&
      options.migrateExisting !== false &&
      (await shouldMigrateDefaultVault(defaultBrainlinkConfig.vault, targetVault))
    const migration = explicitSource || shouldAutoMigrate ? await migrateVaultContent(explicitSource ?? defaultBrainlinkConfig.vault, targetVault) : undefined
    const index = migration && migration.copied + migration.conflicted > 0 ? await indexVault(targetVault) : undefined

    print(
      options.json,
      { path, ...(migration ? { migration } : {}), ...(index ? { index } : {}) },
      () => {
        const migrated = migration
          ? ` Migrated ${migration.copied} files, preserved ${migration.conflicted} conflicts and kept ${migration.unchanged} unchanged files.`
          : ''

        return `Initialized Brainlink vault at ${path}.${migrated}`
      }
    )
  })

  program
    .command('migrate-vault')
    .option('--from <vault>', 'source vault path')
    .option('--to <vault>', 'target vault path')
    .option('--dry-run', 'preview migration without writing files')
    .option('--report <path>', 'write detailed per-file migration report to JSON file')
    .option('--no-index', 'skip reindexing target vault after migration')
    .option('--json', 'print machine-readable JSON')
    .description('copy markdown memory from one vault to another with conflict preservation')
    .action(async (options: MigrateVaultOptions) => {
      const config = await loadBrainlinkConfig()
      const sourceVault = assertVaultAllowed(options.from ?? config.vault, config.allowedVaults)
      const targetVault = assertVaultAllowed(options.to ?? defaultBrainlinkConfig.vault, config.allowedVaults)
      const sourceRoot = await ensureVault(sourceVault)
      const targetRoot = await ensureVault(targetVault)
      const preview = await previewVaultMigration(sourceVault, targetVault)
      const actions = await planVaultMigration(sourceRoot, targetRoot)
      const reportEntries = actions.map((action) => ({
        kind: action.kind,
        sourcePath: action.sourcePath,
        sourceRelativePath: relative(sourceRoot, action.sourcePath),
        targetPath: action.targetPath,
        targetRelativePath: relative(targetRoot, action.targetPath)
      }))

      const writeReport = async (): Promise<string | null> => {
        if (!options.report) {
          return null
        }

        const reportPath = resolve(options.report)

        await mkdir(dirname(reportPath), { recursive: true })
        await writeFile(
          reportPath,
          `${JSON.stringify({ source: sourceVault, target: targetVault, summary: preview, entries: reportEntries }, null, 2)}\n`,
          'utf8'
        )

        return reportPath
      }

      if (options.dryRun) {
        const reportPath = await writeReport()

        print(
          options.json,
          { dryRun: true, ...preview, entries: reportEntries, ...(reportPath ? { reportPath } : {}) },
          () =>
            `Dry run migration ${preview.source} -> ${preview.target}: copy=${preview.copied}, conflicts=${preview.conflicted}, unchanged=${preview.unchanged}${reportPath ? ` report=${reportPath}` : ''}`
        )
        return
      }

      const migration = await migrateVaultContent(sourceVault, targetVault)
      const shouldIndex = options.index !== false && migration.copied + migration.conflicted > 0
      const index = shouldIndex ? await indexVault(targetVault) : undefined
      const reportPath = await writeReport()

      print(
        options.json,
        { dryRun: false, ...migration, entries: reportEntries, ...(index ? { index } : {}), ...(reportPath ? { reportPath } : {}) },
        () => {
          const summary = `Migrated ${migration.copied} files, preserved ${migration.conflicted} conflicts and kept ${migration.unchanged} unchanged files.`
          const indexMessage = index
            ? ` Indexed ${index.documentCount} documents, ${index.chunkCount} chunks and ${index.linkCount} links.`
            : ''
          const reportMessage = reportPath ? ` Report written to ${reportPath}.` : ''

          return `${summary}${indexMessage}${reportMessage}`
        }
      )
    })

  program
    .command('db-import')
    .option('-v, --vault <vault>', 'vault directory')
    .option('--db <path>', 'legacy SQLite database path (default: <vault>/.brainlink/brainlink.db)')
    .option('--table <name>', 'legacy table name override')
    .option('-a, --agent <agent>', 'force imported notes into a target agent namespace')
    .option('-l, --limit <limit>', 'maximum number of rows to import')
    .option('--dry-run', 'preview import without writing Markdown files')
    .option('--no-index', 'skip reindexing after import')
    .option('--json', 'print machine-readable JSON')
    .description('import legacy SQLite memory into Markdown vault and current index model')
    .action(async (options: DbImportOptions) => {
      const resolved = await resolveOptions(options)
      const result = await importLegacySqliteDatabase(resolved.vault, {
        dbPath: options.db,
        table: options.table,
        agentOverride: options.agent ? resolved.agent : undefined,
        limit: options.limit ? parsePositiveInteger(options.limit, 100_000) : undefined,
        dryRun: Boolean(options.dryRun)
      })
      const shouldIndex = options.index !== false && !result.dryRun && result.imported > 0
      const index = shouldIndex ? await indexVault(resolved.vault) : undefined

      print(
        options.json,
        { ...result, ...(index ? { index } : {}) },
        () => {
          const summary = `Imported ${result.imported}/${result.rowsRead} rows from ${result.table} (skipped ${result.skipped}).`
          const indexMessage = index
            ? ` Indexed ${index.documentCount} documents, ${index.chunkCount} chunks and ${index.linkCount} links.`
            : ''
          const dryRunMessage = result.dryRun ? ' Dry run only; no files were written.' : ''

          return `${summary}${indexMessage}${dryRunMessage}`
        }
      )
    })

  program
    .command('add')
  .argument('<title>', 'note title')
  .option('-c, --content <content>', 'markdown content')
  .option('-f, --content-file <contentFile>', 'read markdown content from a file')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'agent memory namespace')
  .option('--allow-sensitive', 'allow writing content that looks like a secret')
  .option('--no-auto-index', 'skip reindexing after add')
  .option('--json', 'print machine-readable JSON')
  .description('add a markdown note to the vault')
  .action(async (title: string, options: AddOptions) => {
    const resolved = await resolveOptions(options)
    const content = resolveAddContent(options)
    const added = await addNoteWithMetadata(resolved.vault, title, content, resolved.agent, {
      allowSensitive: Boolean(options.allowSensitive)
    })
    const shouldAutoIndex = options.autoIndex !== false && resolved.config.autoIndexOnWrite
    const index = shouldAutoIndex ? await indexVault(resolved.vault) : undefined
    const absoluteVaultPath = await ensureVault(resolved.vault)
    const focusPath = added.path.startsWith(absoluteVaultPath)
      ? relative(absoluteVaultPath, added.path).replaceAll('\\', '/')
      : added.path.includes('agents/')
        ? added.path.slice(added.path.indexOf('agents/')).replaceAll('\\', '/')
        : undefined
    const possibleDuplicates = await scanDuplicateNotes(resolved.vault, {
      agentId: resolved.agent,
      focusPath,
      limit: 5,
      minSemanticScore: 0.92,
      includeSemantic: true
    })

    print(
      options.json,
      {
        title,
        agent: resolved.agent ?? 'shared',
        path: added.path,
        writeConnectivity: {
          autoLinked: added.autoLinked,
          linkTarget: added.linkTarget,
          guaranteedEdge: true
        },
        possibleDuplicates,
        ...(index ? { index } : {})
      },
      () => {
        const duplicateMessage =
          possibleDuplicates.length > 0
            ? `\nPotential duplicates: ${possibleDuplicates.length}. Use "blink dedupe --json" or "blink dedupe-resolve".`
            : ''
        return `Created note at ${added.path}${duplicateMessage}`
      }
    )
  })

  program
    .command('dedupe')
    .option('-v, --vault <vault>', 'vault directory')
    .option('-a, --agent <agent>', 'agent memory namespace')
    .option('-l, --limit <limit>', 'maximum duplicate candidate pairs')
    .option('--min-score <score>', 'minimum semantic similarity score between 0 and 1', '0.92')
    .option('--no-semantic', 'disable semantic duplicate detection and keep exact-content matching only')
    .option('--json', 'print machine-readable JSON')
    .description('detect possible duplicate notes with exact hash and semantic similarity scores')
    .action(async (options: DedupeOptions) => {
      const resolved = await resolveOptions(options)
      const duplicates = await scanDuplicateNotes(resolved.vault, {
        agentId: resolved.agent,
        limit: parsePositiveInteger(options.limit ?? '25', 25),
        minSemanticScore: parseScore(options.minScore, 0.92),
        includeSemantic: options.semantic !== false
      })

      print(options.json, { vault: resolved.vault, agent: resolved.agent, duplicates }, () => {
        if (duplicates.length === 0) {
          return 'No possible duplicates found.'
        }

        return duplicates
          .map(
            (item, index) =>
              `${index + 1}. [${item.kind}] score=${item.score.toFixed(4)} ${item.left.path} <-> ${item.right.path} (${item.reason})`
          )
          .join('\n')
      })
    })

  program
    .command('dedupe-resolve')
    .option('-v, --vault <vault>', 'vault directory')
    .option('--left <path>', 'left note relative path from dedupe result')
    .option('--right <path>', 'right note relative path from dedupe result')
    .option('--action <action>', 'resolution action: merge, link or ignore')
    .option('--no-auto-index', 'skip reindex after duplicate resolution')
    .option('--json', 'print machine-readable JSON')
    .description('resolve a duplicate candidate with merge, link or ignore')
    .action(async (options: DedupeResolveOptions) => {
      const resolved = await resolveOptions(options)
      if (!options.left || !options.right) {
        throw new Error('Use --left <path> and --right <path> to resolve a duplicate pair.')
      }
      if (options.action !== 'merge' && options.action !== 'link' && options.action !== 'ignore') {
        throw new Error('Use --action merge|link|ignore.')
      }

      const result = await resolveDuplicateNotes(resolved.vault, {
        leftPath: options.left,
        rightPath: options.right,
        action: options.action,
        autoIndex: options.autoIndex !== false
      })

      print(
        options.json,
        {
          vault: resolved.vault,
          ...result
        },
        () => `Resolved duplicate (${result.action}) for ${result.leftPath} <-> ${result.rightPath}`
      )
    })

  program
    .command('index')
  .option('-v, --vault <vault>', 'vault directory')
  .option('--json', 'print machine-readable JSON')
  .description('index markdown notes, links, tags and chunks')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const result = await indexVault(resolved.vault)

    print(
      options.json,
      result,
      () => `Indexed ${result.documentCount} documents, ${result.chunkCount} chunks and ${result.linkCount} links`
    )
  })

  program
    .command('bench')
    .option('-v, --vault <vault>', 'vault directory')
    .option('-w, --watch', 'watch markdown changes and re-run benchmark in realtime')
    .option('--debounce <ms>', 'watch debounce in milliseconds', '350')
    .option('--json', 'print machine-readable JSON events')
    .description('benchmark indexing in realtime, including compressed pack behavior')
    .action(async (options: BenchOptions) => {
      const resolved = await resolveOptions(options)
      const config = await loadBrainlinkConfig()
      const emitProgress = (event: IndexVaultProgressEvent): void => {
        printBenchRealtimeEvent(options.json, event)
      }

      const printBenchError = (error: unknown): void => {
        const message = error instanceof Error ? error.message : String(error)
        print(options.json, { event: 'bench-error', message }, () => `[bench] error ${message}`)
      }

      const runAndPrint = async (trigger: 'manual' | 'watch'): Promise<IndexVaultResult> => {
        const baseline = await readBenchHistory(resolved.vault)
        const result = await indexVaultWithOptions(resolved.vault, {
          onProgress: emitProgress
        })
        printBenchSummary(options.json, trigger, resolved.vault, result)
        const guardrails = evaluateBenchGuardrails(config, result, baseline)
        printBenchGuardrails(options.json, resolved.vault, config, guardrails)
        await writeBenchHistory(resolved.vault, result)
        return result
      }

      if (!options.watch) {
        await runAndPrint('manual')
        return
      }

      const debounceMs = parsePositiveInteger(options.debounce ?? '350', 350)
      await runAndPrint('manual')

      print(
        options.json,
        {
          event: 'bench-watching',
          vault: resolved.vault,
          debounceMs
        },
        () => `[bench] watching ${resolved.vault} (debounce=${debounceMs}ms)`
      )

      const watcher = startVaultWatcher({
        vaultPath: resolved.vault,
        debounceMs,
        onProgress: emitProgress,
        onIndex: (result) => {
          printBenchSummary(options.json, 'watch', resolved.vault, result)
        },
        onError: printBenchError
      })

      await new Promise<void>((resolveSignal) => {
        const shutdown = (): void => {
          watcher.close()
          resolveSignal()
        }

        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)
      })
    })

  program
    .command('doctor')
  .option('-v, --vault <vault>', 'vault directory')
  .option('--json', 'print machine-readable JSON')
  .description('run Brainlink environment and vault checks')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const report = await doctorVault(resolved.vault)

    print(options.json, report, () => {
      const checks = report.checks.map((check) => `${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.message}`).join('\n')
      const recommendations =
        report.recommendations && report.recommendations.length > 0
          ? `\n\nRecommended next steps:\n${report.recommendations.map((step) => `- ${step}`).join('\n')}`
          : ''

      return `${checks}${recommendations}`
    })
    process.exitCode = report.ok ? 0 : 1
    })

  program
    .command('pack-backup')
    .option('-v, --vault <vault>', 'vault directory')
    .option('-o, --output <path>', 'output file path (.blpkbak.gz)')
    .option('--json', 'print machine-readable JSON')
    .description('create offline backup with second-stage compression for encrypted search packs')
    .action(async (options: PackBackupOptions) => {
      const resolved = await resolveOptions(options)
      const outputPath =
        options.output?.trim().length
          ? resolve(options.output)
          : join(
              resolved.vault,
              '.brainlink',
              'backups',
              `search-packs-${new Date().toISOString().replace(/[:.]/g, '-')}.blpkbak.gz`
            )

      const backup = await createOfflinePackBackup({
        vaultPath: resolved.vault,
        outputPath
      })

      print(
        options.json,
        {
          vault: resolved.vault,
          backup
        },
        () =>
          [
            `Offline backup created: ${backup.outputPath}`,
            `files=${backup.fileCount}`,
            `input=${formatBytes(backup.inputBytes)} output=${formatBytes(backup.outputBytes)} saved=${((1 - backup.ratio) * 100).toFixed(2)}%`
          ].join('\n')
      )
    })

  program
    .command('watch')
  .option('-v, --vault <vault>', 'vault directory')
  .option('--json', 'print machine-readable JSON events')
  .description('watch markdown files and reindex on changes')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const initial = await indexVault(resolved.vault)
    const watcher = startVaultWatcher({
      vaultPath: resolved.vault,
      onIndex: (result) => {
        print(options.json, { event: 'indexed', result }, () =>
          `Indexed ${result.documentCount} documents, ${result.chunkCount} chunks and ${result.linkCount} links`
        )
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error)
        print(options.json, { event: 'error', message }, () => message)
      }
    })

    print(options.json, { event: 'watching', vault: resolved.vault, initial }, () => `Watching ${resolved.vault}`)

    process.once('SIGINT', () => {
      watcher.close()
      process.exit(0)
    })
    process.once('SIGTERM', () => {
      watcher.close()
      process.exit(0)
    })
  })

  program
    .command('server')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-h, --host <host>', 'server host', '127.0.0.1')
  .option('-p, --port <port>', 'server port', '4321')
  .option('--no-index', 'skip indexing before starting the server')
  .option('--no-open', 'do not open the graph UI automatically')
  .option('-w, --watch', 'watch markdown files and reindex on changes')
  .option('--json', 'print machine-readable JSON')
  .description('start a local web UI for the knowledge graph')
  .action(async (options: ServerOptions) => {
    const resolved = await resolveOptions(options)
    const server = await startServer({
      vaultPath: resolved.vault,
      host: options.host ?? resolved.config.host,
      port: parsePositiveInteger(options.port ?? String(resolved.config.port), resolved.config.port),
      shouldIndex: options.index,
      shouldWatch: Boolean(options.watch)
    })
    const openResult = options.open !== false ? openUrlInUi(server.url, process.pid) : { opened: false, mode: 'none' as const }

    print(
      options.json,
      {
        url: server.url,
        watch: Boolean(options.watch),
        readonly: true,
        openedUi: openResult.opened,
        openMode: openResult.mode
      },
      () =>
        `Brainlink graph server running at ${server.url}${
          openResult.opened
            ? openResult.mode === 'native-gui'
              ? ' (opened in native desktop GUI)'
              : openResult.mode === 'app-window'
                ? ' (opened in dedicated app window)'
                : ' (opened in browser)'
            : options.open === false
              ? ' (auto-open disabled)'
              : ''
        }`
    )
  })

  program
    .command('quickstart')
    .option('-v, --vault <vault>', 'vault directory')
    .option('-a, --agent <agent>', 'agent memory namespace')
    .option('--query <query>', 'optional task query to return immediate grounded context')
    .option('--mode <mode>', 'search mode for context (fts|semantic|hybrid)')
    .option('--limit <limit>', 'maximum context sections')
    .option('--tokens <tokens>', 'maximum context token budget')
    .option('--no-install-agent', 'skip agent MCP/plugin installation and upgrade automation')
    .option('--mcp-only', 'when installing agent integration, only configure MCP section')
    .option('--plugin-path <path>', 'custom source path for Brainlink plugin files')
    .option('--allowed-vaults <paths>', 'comma separated vault allowlist to inject in MCP env')
    .option('--brainlink-home <path>', 'BRAINLINK_HOME value to inject in MCP env')
    .option('--json', 'print machine-readable JSON')
    .description('run plug-and-play setup for vault, MCP integration and bootstrap readiness')
    .action(async (options: QuickstartOptions) => {
      const resolved = await resolveOptions(options)
      const limit = parsePositiveInteger(options.limit ?? String(resolved.defaults.defaultSearchLimit), resolved.defaults.defaultSearchLimit)
      const tokens = parsePositiveInteger(options.tokens ?? String(resolved.defaults.defaultContextTokens), resolved.defaults.defaultContextTokens)
      const mode = sanitizeSearchMode(options.mode, resolved.defaults.defaultSearchMode)
      const index = await indexVault(resolved.vault)
      const stats = await getStats(resolved.vault, resolved.agent)
      const validation = await validateVault(resolved.vault, resolved.agent)
      const doctor = await doctorVault(resolved.vault)
      const session = await touchBootstrapSession(resolved.vault, resolved.agent)
      const policy = await getBootstrapPolicy()
      const bootstrapStatus = await getBootstrapSessionStatus(resolved.vault, resolved.agent)
      const context = options.query
        ? await buildContextPackage(resolved.vault, options.query, limit, tokens, resolved.agent, mode)
        : null
      const agentIntegration =
        options.installAgent === false
          ? null
          : await installAgentIntegration({
              mcpOnly: options.mcpOnly,
              pluginPath: options.pluginPath,
              allowedVaults: options.allowedVaults,
              brainlinkHome: options.brainlinkHome,
              selfTest: true
            })
      const nextActions =
        stats.documentCount === 0
          ? [
              {
                priority: 'required',
                command: `blink add "Architecture" --vault "${resolved.vault}" --content "Durable memory with [[Links]] and #tags."`,
                reason: 'Seed your vault with at least one durable Markdown note.'
              },
              {
                priority: 'required',
                command: `blink index --vault "${resolved.vault}"`,
                reason: 'Rebuild index after adding notes so retrieval can find new memory.'
              }
            ]
          : options.query
            ? [
                {
                  priority: 'recommended',
                  command: `blink add "Task Update" --vault "${resolved.vault}" --agent "${resolved.agent ?? 'shared'}" --content "<durable memory>"`,
                  reason: 'Persist important findings as Markdown notes after using the returned context.'
                }
              ]
            : [
                {
                  priority: 'recommended',
                  command: `blink context "<task>" --vault "${resolved.vault}" --agent "${resolved.agent ?? 'shared'}" --mode ${mode}`,
                  reason: 'Retrieve grounded context for each task before responding.'
                }
              ]

      print(
        options.json,
        {
          vault: resolved.vault,
          agent: resolved.agent ?? 'shared',
          mode,
          index,
          stats,
          validation,
          doctor,
          policy,
          bootstrapStatus,
          session,
          context,
          agentIntegration,
          nextActions
        },
        () =>
          [
            `quickstart vault=${resolved.vault}`,
            `agent=${resolved.agent ?? 'shared'}`,
            `documents=${stats.documentCount}`,
            `links=${stats.linkCount}`,
            `bootstrapReady=${bootstrapStatus.ready}`,
            ...(agentIntegration?.selfTest ? [`agentIntegrationSelfTest=${agentIntegration.selfTest.ok}`] : []),
            ...(nextActions.length > 0 ? ['Next actions:', ...nextActions.map((step) => `- ${step.command}`)] : [])
          ].join('\n')
      )
    })
}
