import { ipcMain, BrowserWindow } from 'electron';
import { WhisperServer } from '../whisper/whisper-server';
import { AudioProcessor } from '../whisper/audio-processor';
import { TranscriptionResult, TranscriptionError, TranscriptionStatusUpdate } from '../../shared/types';

let whisperServer: WhisperServer | null = null;
let chunkCounter = 0;
let handlersRegistered = false;

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

  ipcMain.on('start-recording', (event) => {
    console.log('[Main] Start recording request received');
    chunkCounter = 0;
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

        mainWindow.webContents.send('transcription-result', transcriptionResult);
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
