import { ipcMain, BrowserWindow } from 'electron';
import { WhisperRunner } from '../whisper/whisper-runner';
import { AudioProcessor } from '../whisper/audio-processor';
import { TranscriptionResult, TranscriptionError, TranscriptionStatusUpdate } from '../../shared/types';

let whisperRunner: WhisperRunner | null = null;
let chunkCounter = 0;

export function registerTranscriptionHandlers(mainWindow: BrowserWindow) {
  console.log('Registering transcription IPC handlers');

  // Initialize whisper runner
  try {
    whisperRunner = new WhisperRunner();
    sendStatus(mainWindow, 'ready', 'Whisper.cpp ready');
  } catch (error) {
    console.error('Failed to initialize WhisperRunner:', error);
    sendStatus(mainWindow, 'error', `Failed to initialize: ${(error as Error).message}`);
  }

  ipcMain.on('start-recording', (event) => {
    console.log('Start recording request received');
    chunkCounter = 0;
    sendStatus(mainWindow, 'recording', 'Recording started');
  });

  ipcMain.on('stop-recording', (event) => {
    console.log('Stop recording request received');
    sendStatus(mainWindow, 'ready', 'Recording stopped');
  });

  ipcMain.on('process-audio-chunk', async (event, audioData) => {
    console.log('[Main] Process audio chunk request received');
    console.log('[Main]   Buffer length:', audioData.buffer?.length || 0);
    console.log('[Main]   Sample rate:', audioData.sampleRate);
    console.log('[Main]   Timestamp:', audioData.timestamp);

    if (!whisperRunner) {
      console.error('[Main] Whisper runner not initialized!');
      sendError(mainWindow, 'Whisper runner not initialized', chunkCounter);
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
      // Transcribe using whisper.cpp
      const result = await whisperRunner.transcribe(wavFilePath);

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
