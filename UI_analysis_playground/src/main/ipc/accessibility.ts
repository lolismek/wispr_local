import { ipcMain, BrowserWindow } from 'electron';
import { MonitorBridge } from '../native/monitor-bridge';
import { PermissionManager } from '../permissions/permission-manager';
import { MonitorUpdate, MonitorStatusUpdate, MonitorConfig } from '../../shared/types';

let monitorBridge: MonitorBridge | null = null;
const permissionManager = new PermissionManager();

export function registerAccessibilityHandlers(mainWindow: BrowserWindow) {
  console.log('[IPC] Registering accessibility handlers');

  // Check permission
  ipcMain.handle('check-accessibility-permission', async () => {
    const hasPermission = await permissionManager.checkAccessibilityPermission();
    const binaryExists = permissionManager.binaryExists();
    return { hasPermission, binaryExists };
  });

  // Request permission
  ipcMain.handle('request-accessibility-permission', async () => {
    await permissionManager.requestAccessibilityPermission();
    return { requested: true };
  });

  // Start monitoring
  ipcMain.handle('start-monitoring', async (_event, config?: Partial<MonitorConfig>) => {
    if (monitorBridge) {
      console.log('[IPC] Monitor already running');
      return { success: false, error: 'Monitor already running' };
    }

    // Check if binary exists first
    if (!permissionManager.binaryExists()) {
      sendStatus(mainWindow, 'error', 'Swift binary not found. Run npm run build:swift first.');
      return { success: false, error: 'Binary not found' };
    }

    try {
      monitorBridge = new MonitorBridge(config);

      // Forward updates to renderer
      monitorBridge.on('update', (update: MonitorUpdate) => {
        mainWindow.webContents.send('text-boxes-update', update);
      });

      // Handle errors
      monitorBridge.on('error', (error: { message: string }) => {
        console.error('[IPC] Monitor error:', error.message);
        sendStatus(mainWindow, 'error', error.message);
      });

      // Handle permission denied
      monitorBridge.on('permission_denied', (message: string) => {
        console.error('[IPC] Permission denied:', message);
        sendStatus(mainWindow, 'permission_denied', message);
        monitorBridge = null;
      });

      // Handle started
      monitorBridge.on('started', () => {
        sendStatus(mainWindow, 'running', 'Monitoring active');
      });

      sendStatus(mainWindow, 'starting', 'Starting monitor...');
      monitorBridge.start();

      return { success: true };
    } catch (error) {
      console.error('[IPC] Failed to start monitor:', error);
      sendStatus(mainWindow, 'error', (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  });

  // Stop monitoring
  ipcMain.handle('stop-monitoring', async () => {
    if (!monitorBridge) {
      return { success: false, error: 'Monitor not running' };
    }

    try {
      monitorBridge.stop();
      monitorBridge = null;
      sendStatus(mainWindow, 'stopped', 'Monitor stopped');
      return { success: true };
    } catch (error) {
      console.error('[IPC] Failed to stop monitor:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get current status
  ipcMain.handle('get-monitor-status', () => {
    return {
      isRunning: monitorBridge !== null,
    };
  });
}

function sendStatus(window: BrowserWindow, status: MonitorStatusUpdate['status'], message?: string) {
  const statusUpdate: MonitorStatusUpdate = {
    status,
    message,
  };
  window.webContents.send('monitor-status', statusUpdate);
}

// Cleanup on app quit
export function cleanupMonitor() {
  if (monitorBridge) {
    monitorBridge.stop();
    monitorBridge = null;
  }
}
