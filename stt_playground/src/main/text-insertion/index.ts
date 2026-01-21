import { clipboard } from 'electron';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TextInsertionResult {
  success: boolean;
  error?: string;
}

/**
 * Insert text into the currently focused text field
 * Uses clipboard + Cmd+V simulation
 * Automatically saves and restores user's clipboard (transparent operation)
 *
 * Simplified approach: We just paste unconditionally. If no text field is focused,
 * the paste will simply do nothing (macOS behavior). This avoids complex AppleScript
 * that was causing syntax errors.
 */
export async function insertTextIntoFocusedField(text: string): Promise<TextInsertionResult> {
  const callId = Date.now() + Math.random(); // Unique ID for this call
  console.log('[TextInsertion] 🎯 FUNCTION CALLED [ID:%s]', callId);

  try {
    console.log('[TextInsertion] Inserting text (length: %d chars) [ID:%s]', text.length, callId);

    // 1. Save current clipboard content
    const previousClipboard = clipboard.readText();
    console.log('[TextInsertion] Saved clipboard [ID:%s]', callId);

    // 2. Write text to clipboard with space prefix (for natural spacing)
    const textToInsert = ' ' + text;
    clipboard.writeText(textToInsert);
    console.log('[TextInsertion] Wrote to clipboard [ID:%s]', callId);

    // 3. Simulate Cmd+V to paste
    // Using key code 9 (which is 'v') - more reliable than keystroke
    // Key codes work better with System Events than keystroke commands
    console.log('[TextInsertion] About to simulate Cmd+V [ID:%s]', callId);
    await execAsync('osascript -e \'tell application "System Events" to key code 9 using command down\'');
    console.log('[TextInsertion] Simulated Cmd+V [ID:%s]', callId);

    // 4. Wait for paste to complete
    await new Promise(resolve => setTimeout(resolve, 150));

    // 5. Restore previous clipboard content
    clipboard.writeText(previousClipboard);
    console.log('[TextInsertion] ✓ Clipboard restored, text inserted [ID:%s]', callId);

    return { success: true };
  } catch (error) {
    console.error('[TextInsertion] ✗ Error inserting text [ID:%s]:', callId, error);
    // Try to restore clipboard even on error
    try {
      const previousClipboard = clipboard.readText();
      if (previousClipboard !== text && previousClipboard !== ' ' + text) {
        // Clipboard wasn't restored yet, try to restore it
        clipboard.writeText(previousClipboard);
      }
    } catch (restoreError) {
      console.error('[TextInsertion] Failed to restore clipboard:', restoreError);
    }
    return { success: false, error: (error as Error).message };
  }
}
