import AppKit
import Foundation

class WindowMonitor {
    private let config: MonitorConfig
    private let accessibilityQuery: AccessibilityQuery
    private let outputStreamer: OutputStreamer

    private var refreshTimer: Timer?
    private var currentActivePID: pid_t = 0
    private var currentAppName: String = ""
    private var lastTextBoxes: [TextBoxInfo] = []
    private var isRunning = false

    init(config: MonitorConfig) {
        self.config = config
        self.accessibilityQuery = AccessibilityQuery(maxDepth: config.maxDepth, debugMode: config.debugMode)
        self.outputStreamer = OutputStreamer()
    }

    // MARK: - Public API

    func startMonitoring() {
        guard !isRunning else { return }
        isRunning = true

        // Subscribe to active app change notifications
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(activeAppDidChange(_:)),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )

        // Initial query of current active app
        if let frontmostApp = NSWorkspace.shared.frontmostApplication {
            handleAppActivation(app: frontmostApp)
        }

        // Start periodic refresh timer
        refreshTimer = Timer.scheduledTimer(
            withTimeInterval: config.refreshInterval,
            repeats: true
        ) { [weak self] _ in
            self?.performPeriodicRefresh()
        }

        // Keep timer running even during tracking
        RunLoop.current.add(refreshTimer!, forMode: .common)
    }

    func stopMonitoring() {
        isRunning = false
        refreshTimer?.invalidate()
        refreshTimer = nil
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    // MARK: - Notification Handlers

    @objc private func activeAppDidChange(_ notification: Notification) {
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
            return
        }
        handleAppActivation(app: app)
    }

    // MARK: - App Handling

    private func handleAppActivation(app: NSRunningApplication) {
        let pid = app.processIdentifier
        let appName = app.localizedName ?? "Unknown"

        // Update current app
        currentActivePID = pid
        currentAppName = appName

        // Query immediately on app change (including Electron app - it will just find 0 text boxes)
        queryAndStream()
    }

    // MARK: - Querying

    private func performPeriodicRefresh() {
        guard isRunning, currentActivePID != 0 else { return }

        queryAndStream()
    }

    private func queryAndStream() {
        guard currentActivePID != 0 else { return }

        let textBoxes = accessibilityQuery.queryTextBoxes(pid: currentActivePID)
        lastTextBoxes = textBoxes

        outputStreamer.streamUpdate(
            appName: currentAppName,
            appPID: currentActivePID,
            textBoxes: textBoxes,
            isPaused: false
        )
    }
}
