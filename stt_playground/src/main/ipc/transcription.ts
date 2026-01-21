import { ipcMain, BrowserWindow } from 'electron';
import { WhisperServer } from '../whisper/whisper-server';
import { AudioProcessor } from '../whisper/audio-processor';
import { TranscriptionResult, TranscriptionError, TranscriptionStatusUpdate } from '../../shared/types';
import { insertTextIntoFocusedField } from '../text-insertion';

let whisperServer: WhisperServer | null = null;
let chunkCounter = 0;
let handlersRegistered = false;
let isHotkeyMode = false; // Track if recording was started via global hotkey
let lastInsertedText = ''; // Track last inserted text for deduplication
let insertedTexts: string[] = []; // Track recent insertions (last 5)
let isInserting = false; // Semaphore to prevent concurrent insertions

/**
 * Check if the text is a duplicate or very similar to recently inserted text
 * Returns true if it should be skipped (is a duplicate)
 */
function isDuplicateText(newText: string): boolean {
  const normalized = newText.trim().toLowerCase();

  console.log('[Main] 🔍 Checking for duplicate:');
  console.log('[Main]   New text: "%s"', newText);
  console.log('[Main]   Normalized: "%s"', normalized);
  console.log('[Main]   Last inserted: "%s"', lastInsertedText);
  console.log('[Main]   Recent insertions count: %d', insertedTexts.length);

  // Check exact match with last inserted
  if (lastInsertedText && normalized === lastInsertedText.trim().toLowerCase()) {
    console.log('[Main] ❌ Duplicate detected: exact match with last insertion');
    return true;
  }

  // Check if it's in recent insertions (last 5)
  for (let i = 0; i < insertedTexts.length; i++) {
    const recentText = insertedTexts[i];
    const recentNormalized = recentText.trim().toLowerCase();

    console.log('[Main]   Comparing with recent[%d]: "%s"', i, recentText);

    if (normalized === recentNormalized) {
      console.log('[Main] ❌ Duplicate detected: exact match with recent insertion #%d', i);
      return true;
    }

    // Check if new text is just the old text with minor variations (punctuation)
    // e.g., "Hello" vs "Hello!" or "Hello."
    const newTextNoPunct = normalized.replace(/[.,!?;:]/g, '');
    const recentNoPunct = recentNormalized.replace(/[.,!?;:]/g, '');

    console.log('[Main]     Without punctuation - new: "%s", recent: "%s"', newTextNoPunct, recentNoPunct);

    if (newTextNoPunct === recentNoPunct && newTextNoPunct.length > 0) {
      console.log('[Main] ❌ Duplicate detected: same text with different punctuation (recent #%d)', i);
      return true;
    }
  }

  console.log('[Main] ✅ Text is unique, not a duplicate');
  return false;
}

/**
 * Track inserted text for deduplication
 */
function trackInsertedText(text: string) {
  lastInsertedText = text;
  insertedTexts.push(text);
  // Keep only last 5 insertions
  if (insertedTexts.length > 5) {
    insertedTexts.shift();
  }
}

/**
 * Reset insertion tracking (called when recording starts)
 */
function resetInsertionTracking() {
  lastInsertedText = '';
  insertedTexts = [];
  isInserting = false; // Reset semaphore too
  console.log('[Main] Insertion tracking reset');
}

export function registerTranscriptionHandlers(mainWindow: BrowserWindow) {
  // Prevent duplicate registration
  if (handlersRegistered) {
    console.log('[Main] IPC handlers already registered, skipping duplicate registration');
    return;
  }

  console.log('[Main] Registering transcription IPC handlers');
  handlersRegistered = true;

  // Initialize whisper server (persistent process with model loaded in memory)
  try {
    whisperServer = new WhisperServer();
    sendStatus(mainWindow, 'ready', 'Starting Whisper server...');

    // Start server in background (loads model once, keeps it in memory)
    whisperServer.start().then(() => {
      console.log('[Main] Whisper server ready - model loaded in memory');
      sendStatus(mainWindow, 'ready', 'Ready - model loaded');
    }).catch((error) => {
      console.error('[Main] Failed to start Whisper server:', error);
      sendStatus(mainWindow, 'error', `Server start failed: ${(error as Error).message}`);
    });
  } catch (error) {
    console.error('[Main] Failed to initialize WhisperServer:', error);
    sendStatus(mainWindow, 'error', `Failed to initialize: ${(error as Error).message}`);
  }

  // Handler for hotkey mode toggle
  ipcMain.on('set-hotkey-mode', (event, enabled: boolean) => {
    isHotkeyMode = enabled;
    console.log('[Main] Hotkey mode:', enabled ? 'ENABLED' : 'DISABLED');
    if (enabled) {
      console.log('[Main] Text will be inserted into focused text fields after each chunk');
    } else {
      console.log('[Main] Text will only appear in app UI');
    }
  });

  ipcMain.on('start-recording', (event) => {
    console.log('[Main] Start recording request received');
    chunkCounter = 0;
    resetInsertionTracking(); // Reset deduplication tracking
    sendStatus(mainWindow, 'recording', 'Recording started');
  });

  ipcMain.on('stop-recording', (event) => {
    console.log('[Main] Stop recording request received');
    sendStatus(mainWindow, 'ready', 'Recording stopped');
  });

  ipcMain.on('process-audio-chunk', async (event, audioData) => {
    console.log('[Main] Process audio chunk request received');
    console.log('[Main]   Buffer length:', audioData.buffer?.length || 0);
    console.log('[Main]   Sample rate:', audioData.sampleRate);
    console.log('[Main]   Timestamp:', audioData.timestamp);

    if (!whisperServer) {
      console.error('[Main] Whisper server not initialized!');
      sendError(mainWindow, 'Whisper server not initialized', chunkCounter);
      return;
    }

    if (!whisperServer.isServerReady()) {
      console.error('[Main] Whisper server not ready yet!');
      sendError(mainWindow, 'Whisper server still starting, please wait...', chunkCounter);
      return;
    }

    try {
      sendStatus(mainWindow, 'processing', 'Processing audio...');

      // Convert array back to Float32Array
      const buffer = new Float32Array(audioData.buffer);
      const sampleRate = audioData.sampleRate;
      const timestamp = audioData.timestamp;

      console.log('[Main] Converting to WAV...');
      // Convert to WAV file
      const wavFilePath = await AudioProcessor.convertToWAV(buffer, sampleRate, timestamp);
      console.log('[Main] WAV file created:', wavFilePath);

      console.log('[Main] Starting transcription...');
      // Transcribe using whisper server (model already loaded in memory)
      const result = await whisperServer.transcribe(wavFilePath);

      // Clean up temp file
      await AudioProcessor.cleanupTempFile(wavFilePath);

      if (result.success && result.text) {
        console.log('[Main] Transcription successful:', result.text);
        const transcriptionResult: TranscriptionResult = {
          text: result.text,
          chunkId: chunkCounter++,
          isFinal: false,
        };

        // Send to UI (always)
        mainWindow.webContents.send('transcription-result', transcriptionResult);

        // NEW: If hotkey mode, also insert text into external app (real-time per chunk)
        if (isHotkeyMode) {
          console.log('[Main] 🔑 Hotkey mode active, checking for duplicates...');

          // Check if another insertion is already in progress
          if (isInserting) {
            console.log('[Main] ⏸️  Another insertion already in progress, skipping this call');
          } else if (isDuplicateText(result.text)) {
            // Check if this text is a duplicate before inserting
            console.log('[Main] ⏭️  Skipping duplicate text insertion:', result.text);
          } else {
            console.log('[Main] ✏️  Inserting unique text...');
            isInserting = true; // Set semaphore
            try {
              const insertResult = await insertTextIntoFocusedField(result.text);
              if (insertResult.success) {
                console.log('[Main] ✓ Text inserted via clipboard paste');
                trackInsertedText(result.text); // Track for deduplication
              } else {
                console.log('[Main] ⚠️  Text insertion failed:', insertResult.error);
              }
            } catch (insertError) {
              console.error('[Main] ✗ Text insertion error:', insertError);
              // Don't fail transcription if insertion fails
            } finally {
              isInserting = false; // Release semaphore
              console.log('[Main] 🔓 Insertion semaphore released');
            }
          }
        }

        sendStatus(mainWindow, 'ready', 'Ready for next chunk');
      } else {
        console.error('[Main] Transcription failed:', result.error);
        sendError(mainWindow, result.error || 'Transcription failed', chunkCounter);
        sendStatus(mainWindow, 'ready', 'Ready (previous chunk failed)');
      }
    } catch (error) {
      console.error('[Main] Error processing audio chunk:', error);
      sendError(mainWindow, (error as Error).message, chunkCounter);
      sendStatus(mainWindow, 'error', 'Processing error');
    }
  });
}

function sendStatus(window: BrowserWindow, status: TranscriptionStatusUpdate['status'], message?: string) {
  const statusUpdate: TranscriptionStatusUpdate = {
    status,
    message,
  };
  window.webContents.send('transcription-status', statusUpdate);
}

function sendError(window: BrowserWindow, error: string, chunkId?: number) {
  const errorObj: TranscriptionError = {
    error,
    chunkId,
  };
  window.webContents.send('transcription-error', errorObj);
}
