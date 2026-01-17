import { MonitorUpdate, MonitorStatusUpdate, MonitorConfig } from '../shared/types';

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
