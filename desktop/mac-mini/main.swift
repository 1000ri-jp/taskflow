import Cocoa
import ServiceManagement
import WebKit

final class DesktopMiniAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate {
    private let frameKey = "taskflow.desktop-mini.window-frame.v1"
    // Keep the prototype's width fixed while allowing the user to adjust the
    // vertical reading area. The web content still scrolls inside the window.
    private let fixedWindowWidth: CGFloat = 420
    private let defaultWindowHeight: CGFloat = 720
    private let minimumWindowHeight: CGFloat = 480
    private let maximumWindowHeight: CGFloat = 1200
    private let alwaysOnTopKey = "taskflow.desktop-mini.always-on-top.v1"
    private let launchAtLoginKey = "taskflow.desktop-mini.launch-at-login.v1"
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var statusMenu: NSMenu!
    private var toggleWindowItem: NSMenuItem!
    private var alwaysOnTopItem: NSMenuItem!
    private var launchAtLoginItem: NSMenuItem!
    private var pendingWindowCommand: String?
    private var pageURL: URL

    init(pageURL: URL) {
        self.pageURL = pageURL
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.uiDelegate = self
        webView.allowsMagnification = false

        let initialFrame = savedFrame() ?? NSRect(x: 80, y: 120, width: fixedWindowWidth, height: defaultWindowHeight)
        window = NSWindow(
            contentRect: initialFrame,
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "TaskSlowth Mini"
        window.minSize = NSSize(width: fixedWindowWidth, height: minimumWindowHeight)
        window.maxSize = NSSize(width: fixedWindowWidth, height: maximumWindowHeight)
        window.standardWindowButton(.zoomButton)?.isEnabled = false
        window.isMovableByWindowBackground = true
        window.delegate = self
        window.contentView = webView
        // Normalize any legacy saved frame immediately so future launches
        // never retain the old variable height in preferences.
        UserDefaults.standard.set(NSStringFromRect(initialFrame), forKey: frameKey)
        applyAlwaysOnTop()

        installStatusItem()
        observeWindowFrame()
        webView.load(URLRequest(url: pageURL))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if let command = pendingWindowCommand { applyWindowCommand(command); pendingWindowCommand = nil }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.scheme == "taskslowth-mini" {
            guard let command = url.host, ["show", "hide"].contains(command), url.query == nil,
                  url.path.isEmpty || url.path == "/" else { continue }
            if window == nil { pendingWindowCommand = command } else { applyWindowCommand(command) }
        }
    }

    private func applyWindowCommand(_ command: String) {
        if command == "hide" { hideWindow() } else { showWindow() }
    }

    private func installStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "🗿"
        statusItem.button?.toolTip = "TaskSlowth Mini"
        statusItem.button?.target = self
        statusItem.button?.action = #selector(statusItemClicked)
        statusItem.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])

        statusMenu = NSMenu()
        toggleWindowItem = NSMenuItem(title: "ミニを表示", action: #selector(toggleWindowVisibility), keyEquivalent: "")
        alwaysOnTopItem = NSMenuItem(title: "常に最前面：ON", action: #selector(toggleAlwaysOnTop), keyEquivalent: "")
        launchAtLoginItem = NSMenuItem(title: "ログイン時に起動：OFF", action: #selector(toggleLaunchAtLogin), keyEquivalent: "")
        let quit = NSMenuItem(title: "終了", action: #selector(terminate), keyEquivalent: "q")
        [toggleWindowItem, alwaysOnTopItem, launchAtLoginItem, quit].forEach { item in
            item.target = self
            statusMenu.addItem(item)
        }

        updateStatusMenu()
    }

    private func updateStatusMenu() {
        let visible = window?.isVisible == true && window?.isMiniaturized == false
        toggleWindowItem?.title = visible ? "ミニを隠す" : "ミニを表示"
        alwaysOnTopItem?.title = "常に最前面：\(alwaysOnTopEnabled ? "ON" : "OFF")"
        launchAtLoginItem?.title = "ログイン時に起動：\(launchAtLoginEnabled ? "ON" : "OFF")"
    }

    private func observeWindowFrame() {
        let center = NotificationCenter.default
        [NSWindow.didMoveNotification, NSWindow.didResizeNotification].forEach { name in
            center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                guard let self else { return }
                UserDefaults.standard.set(NSStringFromRect(self.window.frame), forKey: self.frameKey)
            }
        }
    }

    private func savedFrame() -> NSRect? {
        guard let raw = UserDefaults.standard.string(forKey: frameKey) else { return nil }
        let frame = NSRectFromString(raw)
        guard frame.width > 0, frame.height > 0 else { return nil }
        let height = min(max(frame.height, minimumWindowHeight), maximumWindowHeight)
        return NSRect(origin: frame.origin, size: NSSize(width: fixedWindowWidth, height: height))
    }

    private func applyAlwaysOnTop() {
        let enabled = alwaysOnTopEnabled
        window.level = enabled ? .floating : .normal
        alwaysOnTopItem?.state = enabled ? .on : .off
    }

    private var alwaysOnTopEnabled: Bool {
        guard UserDefaults.standard.object(forKey: alwaysOnTopKey) != nil else { return true }
        return UserDefaults.standard.bool(forKey: alwaysOnTopKey)
    }

    private var launchAtLoginEnabled: Bool {
        UserDefaults.standard.bool(forKey: launchAtLoginKey)
    }

    private func notifyWebView(_ eventName: String) {
        webView?.evaluateJavaScript("window.dispatchEvent(new Event('\(eventName)'))", completionHandler: nil)
    }

    @objc private func showWindow() {
        if window.isMiniaturized {
            window.deminiaturize(nil)
        }
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        notifyWebView("taskflow-mini-visible")
        updateStatusMenu()
    }

    @objc private func hideWindow() {
        notifyWebView("taskflow-mini-hidden")
        window.orderOut(nil)
        updateStatusMenu()
    }

    @objc private func toggleWindowVisibility() {
        if window.isVisible && !window.isMiniaturized {
            hideWindow()
        } else {
            showWindow()
        }
    }

    @objc private func statusItemClicked() {
        guard let button = statusItem.button else { return }
        if NSApp.currentEvent?.type == .rightMouseUp {
            updateStatusMenu()
            statusMenu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 2), in: button)
        } else {
            toggleWindowVisibility()
        }
    }

    @objc private func toggleAlwaysOnTop() {
        let next = !alwaysOnTopEnabled
        UserDefaults.standard.set(next, forKey: alwaysOnTopKey)
        applyAlwaysOnTop()
        updateStatusMenu()
    }

    @objc private func toggleLaunchAtLogin() {
        let next = !launchAtLoginEnabled
        do {
            if #available(macOS 13.0, *) {
                if next {
                    try SMAppService.mainApp.register()
                } else {
                    try SMAppService.mainApp.unregister()
                }
            } else {
                // The local prototype intentionally does not edit the legacy
                // LaunchAgents directory on older systems.
                throw NSError(domain: "TaskSlowthMini", code: 1, userInfo: [NSLocalizedDescriptionKey: "macOS 13以降で利用できます"])
            }
            UserDefaults.standard.set(next, forKey: launchAtLoginKey)
        } catch {
            // An unsigned /tmp prototype cannot be registered as a login item.
            // Keep the visible state OFF rather than claiming it succeeded.
            UserDefaults.standard.set(false, forKey: launchAtLoginKey)
        }
        updateStatusMenu()
    }

    @objc private func terminate() {
        NSApp.terminate(nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        hideWindow()
        return false
    }

    func windowDidMiniaturize(_ notification: Notification) {
        notifyWebView("taskflow-mini-hidden")
        updateStatusMenu()
    }

    func windowDidDeminiaturize(_ notification: Notification) {
        notifyWebView("taskflow-mini-visible")
        updateStatusMenu()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

let urlString = CommandLine.arguments.dropFirst().first ?? "https://slowth.1000ri.jp/desktop-mini"
guard let url = URL(string: urlString) else {
    fputs("Invalid TaskFlow mini URL: \(urlString)\n", stderr)
    exit(2)
}

// Launching a second copy (for example, an old prototype bundle) must not
// create another menu-bar item. The existing instance owns the window.
if let bundleIdentifier = Bundle.main.bundleIdentifier,
   let existing = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
    .first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && !$0.isTerminated }) {
    existing.activate(options: [])
    exit(0)
}

let application = NSApplication.shared
let delegate = DesktopMiniAppDelegate(pageURL: url)
application.delegate = delegate
application.run()
