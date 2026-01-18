import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createWindow } from './window';
import { registerTranscriptionHandlers } from './ipc/transcription';

let mainWindow: BrowserWindow | null = null;
let appInitialized = false;

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

  // Open DevTools after a delay to let the renderer initialize
  // Uncomment the line below if you need DevTools
  // setTimeout(() => mainWindow.webContents.openDevTools(), 1000);
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
