import { BrowserWindow } from 'electron';

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: require('path').join(__dirname, 'preload.js'),
    },
    title: 'Voice-to-Text POC',
    resizable: true,
  });

  return window;
}
