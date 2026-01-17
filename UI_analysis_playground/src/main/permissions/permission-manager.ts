import { shell } from 'electron';
import { exec } from 'child_process';
import * as path from 'path';

export class PermissionManager {
  /**
   * Check if accessibility permission is granted.
   * Uses the Swift binary's --check-permission flag for accurate check.
   */
  async checkAccessibilityPermission(): Promise<boolean> {
    return new Promise((resolve) => {
      const binaryPath = path.join(__dirname, '../ax-text-finder');

      exec(`"${binaryPath}" --check-permission`, { timeout: 5000 }, (error, stdout) => {
        const output = stdout.trim();
        if (output === 'granted') {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  /**
   * Request accessibility permission by opening System Preferences.
   */
  async requestAccessibilityPermission(): Promise<void> {
    // Open System Preferences to the Accessibility pane
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  }

  /**
   * Check if the binary exists
   */
  binaryExists(): boolean {
    const fs = require('fs');
    const binaryPath = path.join(__dirname, '../ax-text-finder');
    return fs.existsSync(binaryPath);
  }
}
