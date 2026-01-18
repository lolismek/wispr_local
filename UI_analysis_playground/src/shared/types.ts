// Shared types for IPC communication - matches Swift Models.swift

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface TextBoxInfo {
  role: string;
  position: Position;
  size: Size;
  value: string | null;
  label: string | null;
  placeholder: string | null;
  identifier: string | null;
  description: string | null;
  isFocused: boolean;
  isEnabled: boolean;
}

export interface MonitorUpdate {
  timestamp: number;
  sequenceNumber: number;
  appName: string;
  appPID: number;
  textBoxes: TextBoxInfo[];
  error: string | null;
  isPaused: boolean;
}

export type MonitorStatus = 'stopped' | 'starting' | 'running' | 'error' | 'permission_denied';

export interface MonitorStatusUpdate {
  status: MonitorStatus;
  message?: string;
}

export interface MonitorConfig {
  refreshInterval: number; // milliseconds
  maxDepth: number;
  debugMode: boolean;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  refreshInterval: 500,
  maxDepth: 30,  // Increased for Electron apps with deeper hierarchies
  debugMode: false,  // Set to true for debugging
};
