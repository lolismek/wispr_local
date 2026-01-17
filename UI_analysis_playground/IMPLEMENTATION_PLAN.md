# Implementation Plan: macOS Live Text Box Monitor using Accessibility API

## Overview
Build an Electron application in `UI_analysis_playground/` that continuously monitors the user's active window and displays all text boxes in real-time using Apple's Accessibility API.

## Architecture Approach

**Native Integration**: Long-running Swift process called via `child_process` from Electron main process
- **Why**: Cleaner separation, easier debugging, no node-gyp complexity, better error isolation
- **Live Monitoring**: Swift process monitors active window changes and streams updates via stdout
- **Alternative considered**: Native Node.js addon (rejected due to build complexity and crash risk)

**Electron Structure**: 3-process model with continuous data flow
```
Renderer (Live UI) ←IPC Stream→ Main Process (Node.js) ←stdout→ Swift Monitor → macOS Accessibility API
                                                                      ↓
                                                          NSWorkspace Notifications
```

**Monitoring Strategy**:
- Swift process subscribes to `NSWorkspace` active application change notifications
- On app change: immediately query new app's text boxes
- Periodic refresh (500ms) to detect UI changes within the same app
- Ignore updates when Electron app itself becomes active
- Stream JSON updates to stdout, parsed by Node.js

## Critical Files to Create

1. **native/Sources/ax-text-finder/WindowMonitor.swift**
   - Subscribe to NSWorkspace active application change notifications
   - Track current active application (ignore own Electron app)
   - Trigger accessibility queries on app changes
   - Manage periodic refresh timer (500ms default)

2. **native/Sources/ax-text-finder/AccessibilityQuery.swift**
   - Core AXUIElement querying logic
   - Traverse UI hierarchy using breadth-first search (depth limit: 10)
   - Filter for: AXTextField, AXTextArea, AXComboBox
   - Extract attributes: position, size, value, label, placeholder, focused state
   - Return structured TextBoxInfo array

3. **native/Sources/ax-text-finder/OutputStreamer.swift**
   - Format query results as JSON
   - Stream updates to stdout with newline delimiters
   - Include timestamp and sequence number for each update
   - Handle errors gracefully (output error JSON)

4. **src/main/native/monitor-bridge.ts**
   - Spawn Swift monitor process via `child_process.spawn()`
   - Read stdout line-by-line (streaming JSON parser)
   - Parse JSON updates and emit events
   - Handle process crashes and restarts
   - Lifecycle: start/stop/restart methods

5. **src/main/ipc/accessibility.ts**
   - IPC handlers: `check-accessibility-permission`, `request-accessibility-permission`, `start-monitoring`, `stop-monitoring`
   - Forward live updates from monitor-bridge to renderer via `text-boxes-update` channel
   - Permission checking before starting monitor
   - Monitor lifecycle management (ensure single instance)

6. **src/shared/types.ts**
   - TextBoxInfo interface (role, position, size, value, metadata)
   - MonitorUpdate interface (timestamp, appName, appPID, textBoxes, sequenceNumber)
   - MonitorStatus type ('stopped' | 'starting' | 'running' | 'error' | 'permission_denied')
   - MonitorConfig interface (refreshInterval, maxDepth, ignoreOwnApp)

7. **src/renderer/index.ts**
   - Permission status display
   - Start/Stop monitoring buttons
   - Live-updating text box list (reactive UI)
   - Display current app name and last update timestamp
   - Monitoring status indicator (running/stopped/error)

## Implementation Steps

### Phase 1: Project Setup
1. Copy webpack config from `stt_playground/webpack.config.js`
2. Copy TypeScript configs (tsconfig.main.json, tsconfig.renderer.json)
3. Create package.json with dependencies:
   - electron, typescript, webpack, node-mac-permissions
4. Initialize Swift Package Manager project in `native/`
5. Create directory structure:
   ```
   UI_analysis_playground/
   ├── native/                    # Swift monitor process
   ├── src/
   │   ├── main/                  # Node.js process
   │   ├── renderer/              # Browser UI
   │   └── shared/                # Shared types
   └── dist/                      # Build output
   ```

### Phase 2: Swift Monitor Implementation
6. Create Swift Package with ApplicationServices and AppKit frameworks
7. Implement Models.swift (TextBoxInfo, MonitorUpdate structs, Codable)
8. Implement AccessibilityQuery.swift:
   - `createAppElement(pid)` using AXUIElementCreateApplication
   - `traverseUIHierarchy()` breadth-first with depth limit
   - `getAttributeValue()` helper for AXUIElementCopyAttributeValue
   - `queryTextBoxes(pid)` main query function
9. Implement WindowMonitor.swift:
   - Subscribe to `NSWorkspace.didActivateApplicationNotification`
   - Track `currentActivePID` and `electronPID`
   - Implement `startMonitoring()` with notification observer
   - Create refresh timer (500ms) for periodic updates
   - Skip updates when Electron app is active
10. Implement OutputStreamer.swift:
    - `streamUpdate()` formats MonitorUpdate as JSON line
    - `streamError()` for error messages
    - Add sequence numbers and timestamps
11. Implement main.swift:
    - Parse CLI args: `--refresh-interval`, `--electron-pid`
    - Create WindowMonitor instance
    - Run RunLoop to keep process alive
    - Handle signals (SIGTERM, SIGINT) for graceful shutdown
12. Create build.sh script
13. Test monitor independently (observe stdout stream)

### Phase 3: Electron Main Process
14. Create src/shared/types.ts (TypeScript interfaces matching Swift structs)
15. Implement src/main/native/monitor-bridge.ts:
    - `spawn()` Swift monitor with `child_process.spawn()`
    - Line-buffered stdout reader
    - Parse JSON updates and emit `update` events
    - Auto-restart on crash (with exponential backoff)
    - `stop()` method sends SIGTERM
16. Implement src/main/permissions/permission-manager.ts using node-mac-permissions
17. Implement src/main/ipc/accessibility.ts:
    - `start-monitoring` handler: check permissions, start monitor-bridge
    - `stop-monitoring` handler: stop monitor-bridge
    - Forward monitor updates to renderer via `text-boxes-update` channel
    - Single monitor instance enforcement
18. Create src/main/window.ts (BrowserWindow setup with always-on-top option)
19. Create src/main/index.ts (app initialization, register handlers, pass own PID to Swift)

### Phase 4: Preload & Renderer
20. Create src/main/preload.ts (contextBridge API exposure):
    - `startMonitoring()`, `stopMonitoring()`, `checkPermission()`
    - `onTextBoxesUpdate(callback)` listener for live updates
21. Create src/renderer/index.html:
    - Status indicator (monitoring state)
    - Start/Stop buttons
    - Current app display
    - Live text boxes list container
    - Last update timestamp
22. Create src/renderer/styles/main.css (styling with live update animations)
23. Implement src/renderer/index.ts:
    - Permission check on load
    - Start/Stop button handlers
    - Subscribe to `onTextBoxesUpdate` events
    - Update DOM with new text boxes (replace/diff)
    - Status indicator updates (running/stopped/error)
    - Display app name and timestamp

### Phase 5: Build & Integration
24. Configure webpack for 3 processes
25. Add build scripts to package.json:
    - `build:swift` - compile Swift monitor
    - `build:electron` - webpack
    - `build` - both
    - `dev` - build and run with monitoring
26. Test permission flow
27. Test live monitoring with window switching
28. Test UI updates (open TextEdit, type, see updates)
29. Test auto-restart on crash
30. Verify Electron app is ignored when active
31. Performance testing (CPU usage, memory leaks)

## Key Technical Decisions

1. **AX Attributes to Query**:
   - kAXRoleAttribute, kAXPositionAttribute, kAXSizeAttribute
   - kAXValueAttribute, kAXPlaceholderValueAttribute
   - kAXDescriptionAttribute, kAXTitleAttribute, kAXIdentifierAttribute
   - kAXFocusedAttribute, kAXEnabledAttribute

2. **UI Traversal Strategy**:
   - Breadth-first search (prevents deep recursion)
   - Depth limit: 10 levels (safety)
   - Filter: AXTextField, AXTextArea, AXComboBox only

3. **Monitoring Strategy**:
   - Event-driven: NSWorkspace notifications for app switches
   - Polling: 500ms timer for detecting UI changes within same app
   - Debouncing: Ignore rapid app switches (< 100ms)
   - Self-exclusion: Skip queries when Electron app is active

4. **Process Communication**:
   - Swift → Node.js: Newline-delimited JSON over stdout
   - Each update includes: timestamp, sequence number, app info, text boxes
   - Node.js → Renderer: IPC events (fire-and-forget, no request/response)

5. **Error Handling**:
   - Graceful degradation (return partial results)
   - Clear permission error messages
   - Auto-restart Swift process on crash (exponential backoff)
   - Continue monitoring if single query fails

6. **Performance Optimizations**:
   - Cache previous results, only stream if changed
   - Configurable refresh interval (default 500ms)
   - Limit traversal depth to prevent slow queries
   - Kill hung queries after 2 seconds

## Verification Strategy

### Manual Testing
- [ ] Permission request opens System Preferences
- [ ] Start button disabled without permission
- [ ] Monitoring starts and shows "Running" status
- [ ] Switch to Safari → text boxes update immediately
- [ ] Switch to TextEdit → text boxes update immediately
- [ ] Type in text field → UI updates within 500ms
- [ ] Switch to Electron app → display pauses (no self-monitoring)
- [ ] Switch away from Electron → monitoring resumes
- [ ] Click Stop → monitoring stops, UI freezes
- [ ] Correct text box count displayed
- [ ] Position/size values accurate
- [ ] Labels/placeholders extracted correctly
- [ ] Focused state reflects actual focus
- [ ] Test with Safari (web forms)
- [ ] Test with TextEdit (native text)
- [ ] Test with System Preferences (various inputs)
- [ ] Test with VS Code (complex UI)

### Performance Targets
- App switch detection: <50ms (notification-based)
- Simple apps (TextEdit) query: <100ms
- Medium apps (Safari) query: <500ms
- Complex apps (Xcode) query: <2000ms
- CPU usage while idle (no changes): <1%
- CPU usage during active monitoring: <5%
- Memory usage: <50MB (Electron + Swift)

### Error Cases
- Start without permission → clear error message
- Swift process crash → auto-restart within 1 second
- Hung query → timeout and continue monitoring
- App with no text boxes → empty array returned
- Switch apps rapidly → no crashes, debouncing works

### Stress Testing
- [ ] Run for 1 hour → no memory leaks
- [ ] Switch between 10+ apps rapidly → stable
- [ ] Open/close apps while monitoring → no crashes
- [ ] Query complex app (Xcode with large project) → timeout handled

## Reference Files from stt_playground
- `/Users/alexjerpelea/wispr_local/stt_playground/webpack.config.js` - build config
- `/Users/alexjerpelea/wispr_local/stt_playground/src/main/ipc/transcription.ts` - IPC pattern
- `/Users/alexjerpelea/wispr_local/stt_playground/src/shared/types.ts` - type definitions
- `/Users/alexjerpelea/wispr_local/stt_playground/src/main/preload.ts` - contextBridge pattern
- `/Users/alexjerpelea/wispr_local/stt_playground/package.json` - dependencies

## Expected Output

**Initial State** (Electron app first opens):
```
Status: Stopped
Permission: Granted ✓

[Start Monitoring] [Stop Monitoring (disabled)]

No active monitoring
```

**After clicking "Start Monitoring"** (Safari with login form is active):
```
Status: Running ●
Permission: Granted ✓

[Start Monitoring (disabled)] [Stop Monitoring]

Monitoring: Safari (PID: 1234)
Last Update: 2026-01-17 10:23:45.234
Text Boxes Found: 3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Text Box #1
Role: AXTextField
Position: x: 100, y: 200
Size: 300 × 40
Label: Username
Placeholder: Enter username
Focused: Yes ●
Editable: Yes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Text Box #2
Role: AXTextField
Position: x: 100, y: 260
Size: 300 × 40
Label: Password
Value: ••••••••
Focused: No
Editable: Yes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Text Box #3
Role: AXTextArea
Position: x: 100, y: 320
Size: 500 × 120
Label: Comments
Placeholder: Optional feedback
Focused: No
Editable: Yes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**User switches to TextEdit** → UI updates automatically:
```
Status: Running ●
Permission: Granted ✓

[Start Monitoring (disabled)] [Stop Monitoring]

Monitoring: TextEdit (PID: 5678)
Last Update: 2026-01-17 10:23:47.891
Text Boxes Found: 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Text Box #1
Role: AXTextArea
Position: x: 20, y: 80
Size: 760 × 580
Value: Hello World
Focused: Yes ●
Editable: Yes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**User switches back to Electron app** → UI pauses:
```
Status: Running (paused) ⏸
Permission: Granted ✓

[Start Monitoring (disabled)] [Stop Monitoring]

Monitoring paused (own app active)
Last Update: 2026-01-17 10:23:47.891
(Showing last captured state from TextEdit)
```
