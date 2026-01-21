import { app, BrowserWindow, globalShortcut, systemPreferences } from 'electron';
import * as path from 'path';
import { createWindow } from './window';
import { registerTranscriptionHandlers } from './ipc/transcription';

let mainWindow: BrowserWindow | null = null;
let appInitialized = false;

// Global hotkey configuration
// Using Cmd+Shift+Space (easy to press, unlikely to conflict)
const GLOBAL_HOTKEY = 'CommandOrControl+Shift+Space';

function initializeApp() {
  if (appInitialized) {
    console.log('[Main] App already initialized, skipping duplicate initialization');
    return;
  }

  console.log('[Main] Initializing app...');
  appInitialized = true;

  mainWindow = createWindow();

  // Register IPC handlers
  registerTranscriptionHandlers(mainWindow);

  // Log renderer crashes
  mainWindow.webContents.on('crashed', (event, killed) => {
    console.error('[Main] Renderer process crashed! Killed:', killed);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Main] Render process gone!', details);
  });

  // Log unresponsive renderer
  mainWindow.on('unresponsive', () => {
    console.error('[Main] Renderer became unresponsive');
  });

  mainWindow.on('responsive', () => {
    console.log('[Main] Renderer became responsive again');
  });

  // Load the renderer
  const rendererPath = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(rendererPath);

  // Log when page finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Renderer finished loading');
  });

  // Register global hotkey
  registerGlobalHotkey();

  // Open DevTools after a delay to let the renderer initialize
  // Uncomment the line below if you need DevTools
  // setTimeout(() => {
  //   if (mainWindow && !mainWindow.isDestroyed()) {
  //     mainWindow.webContents.openDevTools();
  //   }
  // }, 1000);
}

function registerGlobalHotkey() {
  if (!mainWindow) {
    console.error('[Main] Cannot register hotkey: mainWindow is null');
    return;
  }

  // Register the global hotkey
  const registered = globalShortcut.register(GLOBAL_HOTKEY, () => {
    console.log('[Main] Global hotkey pressed:', GLOBAL_HOTKEY);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toggle-recording-hotkey');
    }
  });

  if (!registered) {
    console.error('[Main] Failed to register global hotkey:', GLOBAL_HOTKEY);
    console.error('[Main] The hotkey may already be registered by another application');
  } else {
    console.log('[Main] ✓ Global hotkey registered:', GLOBAL_HOTKEY);
    console.log('[Main] Press Cmd+Shift+Space anywhere to start/stop recording');
  }
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  // Check accessibility permissions (required for text insertion)
  if (process.platform === 'darwin') {
    const hasAccessibilityPermission = systemPreferences.isTrustedAccessibilityClient(false);
    if (!hasAccessibilityPermission) {
      console.warn('[Main] ⚠️  Accessibility permissions not granted');
      console.warn('[Main] Text insertion into external apps will not work');
      console.warn('[Main] To enable: System Preferences > Security & Privacy > Privacy > Accessibility');
      console.warn('[Main] Add this app to the list and check the box');
    } else {
      console.log('[Main] ✓ Accessibility permissions granted');
    }
  }

  initializeApp();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      initializeApp();
    }
  });
});

// Cleanup global shortcuts before quitting
app.on('will-quit', () => {
  console.log('[Main] Unregistering all global shortcuts');
  globalShortcut.unregisterAll();
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
