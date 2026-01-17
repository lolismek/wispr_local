import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createWindow } from './window';
import { registerAccessibilityHandlers, cleanupMonitor } from './ipc/accessibility';

let mainWindow: BrowserWindow | null = null;

function initializeApp() {
  mainWindow = createWindow();

  // Register IPC handlers
  registerAccessibilityHandlers(mainWindow);

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

  // Cleanup on window close
  mainWindow.on('closed', () => {
    cleanupMonitor();
    mainWindow = null;
  });

  // Uncomment to open DevTools
  // mainWindow.webContents.openDevTools();
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  initializeApp();

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      initializeApp();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  cleanupMonitor();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup before quit
app.on('before-quit', () => {
  cleanupMonitor();
});
