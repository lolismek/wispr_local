import { BrowserWindow } from 'electron';
import * as path from 'path';

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 500,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'Text Box Monitor',
    resizable: true,
    alwaysOnTop: false, // Can be toggled by user
  });

  return window;
}
