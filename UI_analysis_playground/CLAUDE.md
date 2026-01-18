# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

macOS Text Box Monitor - an Electron app that uses Apple's Accessibility API to continuously monitor and display text boxes in the user's active window in real-time.

## App Compatibility

Works with:
- ✅ **Native macOS apps** (Safari, TextEdit, Finder, Mail, etc.)
- ✅ **Safari web content** (form inputs on websites that use Accessibility API)
- ✅ **Electron/Chromium apps** (VS Code, Slack, Discord, Chrome, etc.)

**How Electron support works:**
- Chromium maps its internal accessibility tree to macOS Accessibility API
- Uses the same role names as native apps (`AXTextField`, `AXTextArea`)
- Requires deeper traversal (`maxDepth: 30` vs `10` for native apps)
- Text boxes only appear when visible/focused (normal behavior for performance)

**Note**: Some UI elements only become accessible when they're visible or focused. For example, VS Code's search box only appears in the accessibility tree when you open it (Cmd+Shift+F).

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
./ax-text-finder --refresh-interval 500 --electron-pid 1234 --max-depth 30 --debug --check-permission
```

- `--check-permission` - Outputs "granted" or "denied" and exits (used by permission-manager.ts)
- `--electron-pid` - PID to ignore when that app is active (prevents self-monitoring)
- `--max-depth` - Max UI hierarchy depth to traverse (default: 30, needed for Electron apps)
- `--debug` - Enable debug logging to stderr (shows found/rejected text boxes)
- `--refresh-interval` - Polling interval in milliseconds (default: 500ms)

## Debugging

To enable debug mode, set `debugMode: true` in `src/shared/types.ts` DEFAULT_MONITOR_CONFIG. This will:
- Show `✓ ADDED TEXT BOX: <role>` for each detected text box
- Show `✗ REJECTED <role>: ...` for text boxes that failed editability checks
- Display traversal summaries: `=== Traversal complete: X elements, Y text boxes ===`

Debug output goes to stderr, so it appears in the terminal when running `npm start` or `npm run dev`.

## Technical Notes

### Electron/Chromium Accessibility Mapping

Initially, it appeared that Electron apps like VS Code didn't expose their UI through macOS Accessibility API. Investigation revealed:

1. **Chromium DOES map to macOS Accessibility API** - Screen readers work with Chrome/Electron apps
2. **Role names are identical to native apps** - No special Chromium-specific roles needed
3. **Deeper hierarchy** - Electron apps nest UI elements much deeper (depth 20-30) vs native apps (depth 5-10)
4. **Dynamic exposure** - Many elements only appear in the accessibility tree when visible/focused

The key fix was simply increasing `maxDepth` from 10 to 30 in the default configuration. No changes to role detection or special Chromium handling were needed.

### Editable Text Box Detection

Text boxes are filtered to only show editable fields using a dual strategy:
```swift
let isEditable = isValueSettable || (hasEditableRole && isEnabled)
```

Where:
- `isValueSettable` - `AXUIElementIsAttributeSettable` check on `kAXValueAttribute`
- `hasEditableRole` - Role is AXTextField, AXTextArea, or AXComboBox
- `isEnabled` - Element has `kAXEnabledAttribute` set to true

This handles both native apps (where settable check is reliable) and web content in Safari (where role-based detection is needed).
