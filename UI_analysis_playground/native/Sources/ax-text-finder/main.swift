import Foundation
import AppKit

// MARK: - Argument Parsing

func parseArguments() -> MonitorConfig {
    var config = MonitorConfig()
    let args = CommandLine.arguments

    var i = 1
    while i < args.count {
        switch args[i] {
        case "--refresh-interval":
            if i + 1 < args.count, let interval = Double(args[i + 1]) {
                config.refreshInterval = interval / 1000.0 // Convert ms to seconds
                i += 1
            }
        case "--electron-pid":
            if i + 1 < args.count, let pid = Int32(args[i + 1]) {
                config.electronPID = pid
                i += 1
            }
        case "--max-depth":
            if i + 1 < args.count, let depth = Int(args[i + 1]) {
                config.maxDepth = depth
                i += 1
            }
        case "--debug":
            config.debugMode = true
        case "--help", "-h":
            printHelp()
            exit(0)
        default:
            break
        }
        i += 1
    }

    return config
}

func printHelp() {
    print("""
    ax-text-finder - Live macOS Accessibility Text Box Monitor

    Usage: ax-text-finder [options]

    Options:
      --refresh-interval <ms>   Refresh interval in milliseconds (default: 500)
      --electron-pid <pid>      PID of Electron app to ignore when active
      --max-depth <depth>       Maximum UI hierarchy depth to traverse (default: 30)
      --debug                   Enable debug mode (logs all roles to stderr)
      --check-permission        Check if accessibility permission is granted and exit
      --help, -h                Show this help message

    Output:
      JSON objects are streamed to stdout, one per line.
      Each object contains: timestamp, sequenceNumber, appName, appPID, textBoxes, error, isPaused
    """)
}

// MARK: - Signal Handling

func setupSignalHandlers(monitor: WindowMonitor) {
    signal(SIGTERM) { _ in
        fputs("Received SIGTERM, shutting down...\n", stderr)
        exit(0)
    }

    signal(SIGINT) { _ in
        fputs("Received SIGINT, shutting down...\n", stderr)
        exit(0)
    }
}

// MARK: - Permission Check

func checkAccessibilityPermission() -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): false] as CFDictionary
    return AXIsProcessTrustedWithOptions(options)
}

// MARK: - Main

// Check for --check-permission flag
if CommandLine.arguments.contains("--check-permission") {
    if checkAccessibilityPermission() {
        print("granted")
        exit(0)
    } else {
        print("denied")
        exit(1)
    }
}

let config = parseArguments()

// Check accessibility permission
if !checkAccessibilityPermission() {
    let streamer = OutputStreamer()
    streamer.streamError("Accessibility permission not granted. Grant permission to Terminal.app (or your IDE) in System Preferences > Privacy & Security > Accessibility")
    exit(2)
}

// Create and start monitor
let monitor = WindowMonitor(config: config)
setupSignalHandlers(monitor: monitor)

// Output ready signal
fputs("Monitor started\n", stderr)

monitor.startMonitoring()

// Run the main loop to keep the process alive and receive notifications
RunLoop.main.run()
