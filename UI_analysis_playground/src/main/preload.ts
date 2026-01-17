import { contextBridge, ipcRenderer } from 'electron';
import { MonitorUpdate, MonitorStatusUpdate, MonitorConfig } from '../shared/types';

console.log('[Preload] Preload script executing...');

try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // Permission methods
    checkAccessibilityPermission: () => {
      console.log('[Preload] checkAccessibilityPermission called');
      return ipcRenderer.invoke('check-accessibility-permission');
    },
    requestAccessibilityPermission: () => {
      console.log('[Preload] requestAccessibilityPermission called');
      return ipcRenderer.invoke('request-accessibility-permission');
    },

    // Monitoring methods
    startMonitoring: (config?: Partial<MonitorConfig>) => {
      console.log('[Preload] startMonitoring called');
      return ipcRenderer.invoke('start-monitoring', config);
    },
    stopMonitoring: () => {
      console.log('[Preload] stopMonitoring called');
      return ipcRenderer.invoke('stop-monitoring');
    },
    getMonitorStatus: () => {
      return ipcRenderer.invoke('get-monitor-status');
    },

    // Event listeners
    onTextBoxesUpdate: (callback: (update: MonitorUpdate) => void) => {
      ipcRenderer.on('text-boxes-update', (_event, update) => {
        try {
          callback(update);
        } catch (error) {
          console.error('[Preload] Error in text-boxes-update callback:', error);
        }
      });
    },
    onMonitorStatus: (callback: (status: MonitorStatusUpdate) => void) => {
      ipcRenderer.on('monitor-status', (_event, status) => {
        try {
          callback(status);
        } catch (error) {
          console.error('[Preload] Error in monitor-status callback:', error);
        }
      });
    },

    // Cleanup
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('text-boxes-update');
      ipcRenderer.removeAllListeners('monitor-status');
    },
  });

  console.log('[Preload] electronAPI exposed successfully');
} catch (error) {
  console.error('[Preload] Error exposing electronAPI:', error);
}

// Type definitions
export interface ElectronAPI {
  checkAccessibilityPermission: () => Promise<{ hasPermission: boolean; binaryExists: boolean }>;
  requestAccessibilityPermission: () => Promise<{ requested: boolean }>;
  startMonitoring: (config?: Partial<MonitorConfig>) => Promise<{ success: boolean; error?: string }>;
  stopMonitoring: () => Promise<{ success: boolean; error?: string }>;
  getMonitorStatus: () => Promise<{ isRunning: boolean }>;
  onTextBoxesUpdate: (callback: (update: MonitorUpdate) => void) => void;
  onMonitorStatus: (callback: (status: MonitorStatusUpdate) => void) => void;
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
