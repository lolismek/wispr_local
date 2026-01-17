# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

macOS Text Box Monitor - an Electron app that uses Apple's Accessibility API to continuously monitor and display text boxes in the user's active window in real-time.

**Important Limitation**: Only works with native macOS apps (Safari, TextEdit, Finder, etc.). Electron apps like VS Code don't expose their DOM as native accessibility elements.

## Build Commands

```bash
npm run build:swift    # Compile Swift monitor binary
npm run build:electron # Build Electron app with webpack
npm run build          # Build both Swift and Electron
npm run dev            # Build all and run
npm start              # Run without rebuilding
```

## Architecture

```
Renderer (Live UI) ←IPC→ Main Process (Node.js) ←stdout JSON stream→ Swift Monitor → macOS Accessibility API
                                                                            ↓
                                                              NSWorkspace Notifications
```

**Three-process model:**
1. **Swift Monitor** (`native/Sources/ax-text-finder/`) - Long-running process that queries AXUIElement APIs and streams JSON to stdout
2. **Electron Main** (`src/main/`) - Spawns Swift process, parses JSON stream, forwards to renderer via IPC
3. **Electron Renderer** (`src/renderer/`) - Displays live-updating UI

**Key data flow:**
- Swift subscribes to `NSWorkspace.didActivateApplicationNotification` for app switches
- 500ms polling timer detects UI changes within the same app
- JSON updates streamed line-by-line to stdout, parsed by `monitor-bridge.ts`
- Updates forwarded to renderer via `text-boxes-update` IPC channel

## Key Files

**Swift (native/Sources/ax-text-finder/):**
- `WindowMonitor.swift` - NSWorkspace notifications, refresh timer, coordinates queries
- `AccessibilityQuery.swift` - BFS traversal of AXUIElement hierarchy, extracts text box attributes
- `OutputStreamer.swift` - JSON serialization and stdout streaming
- `main.swift` - CLI args parsing, permission check, signal handling

**Electron Main (src/main/):**
- `native/monitor-bridge.ts` - Spawns/manages Swift process, parses JSON stream, emits events
- `ipc/accessibility.ts` - IPC handlers for start/stop monitoring, permission checks
- `permissions/permission-manager.ts` - Accessibility permission verification via Swift binary

**Shared (src/shared/):**
- `types.ts` - TypeScript interfaces matching Swift Codable structs

## Accessibility Permission

In development, permission must be granted to **Terminal.app** (or the IDE running `npm start`), not the Electron app itself. The Swift binary checks permission with `AXIsProcessTrustedWithOptions`.

## Swift CLI Arguments

```bash
./ax-text-finder --refresh-interval 500 --electron-pid 1234 --max-depth 10 --check-permission
```

- `--check-permission` - Outputs "granted" or "denied" and exits (used by permission-manager.ts)
- `--electron-pid` - PID to ignore when that app is active (prevents self-monitoring)
