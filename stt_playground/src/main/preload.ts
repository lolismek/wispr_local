import { contextBridge, ipcRenderer } from 'electron';
import { AudioChunk, TranscriptionResult, TranscriptionError, TranscriptionStatusUpdate } from '../shared/types';

console.log('[Preload] Preload script executing...');

// Check if already exposed (prevent duplicates)
if ((window as any).electronAPI) {
  console.log('[Preload] electronAPI already exposed, skipping duplicate exposure');
} else {
  console.log('[Preload] Exposing electronAPI for the first time');
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
try {
  contextBridge.exposeInMainWorld('electronAPI', {
    // Send methods
    startRecording: () => {
      console.log('[Preload] startRecording called');
      ipcRenderer.send('start-recording');
    },
    stopRecording: () => {
      console.log('[Preload] stopRecording called');
      ipcRenderer.send('stop-recording');
    },
    processAudioChunk: (audioData: { buffer: number[]; sampleRate: number; timestamp: number }) => {
      console.log('[Preload] processAudioChunk called, buffer size:', audioData.buffer.length);
      try {
        ipcRenderer.send('process-audio-chunk', audioData);
      } catch (error) {
        console.error('[Preload] Error sending audio chunk:', error);
        throw error;
      }
    },

    // Receive methods
    onTranscriptionResult: (callback: (result: TranscriptionResult) => void) => {
      ipcRenderer.on('transcription-result', (_event, result) => {
        try {
          callback(result);
        } catch (error) {
          console.error('[Preload] Error in transcription result callback:', error);
        }
      });
    },
    onTranscriptionError: (callback: (error: TranscriptionError) => void) => {
      ipcRenderer.on('transcription-error', (_event, error) => {
        try {
          callback(error);
        } catch (err) {
          console.error('[Preload] Error in transcription error callback:', err);
        }
      });
    },
    onTranscriptionStatus: (callback: (status: TranscriptionStatusUpdate) => void) => {
      ipcRenderer.on('transcription-status', (_event, status) => {
        try {
          callback(status);
        } catch (error) {
          console.error('[Preload] Error in transcription status callback:', error);
        }
      });
    },

    // Cleanup methods
    removeTranscriptionListeners: () => {
      ipcRenderer.removeAllListeners('transcription-result');
      ipcRenderer.removeAllListeners('transcription-error');
      ipcRenderer.removeAllListeners('transcription-status');
    },
  });

  console.log('[Preload] electronAPI exposed successfully');
} catch (error) {
  console.error('[Preload] Error exposing electronAPI:', error);
}

// Type definition for window.electronAPI
export interface ElectronAPI {
  startRecording: () => void;
  stopRecording: () => void;
  processAudioChunk: (audioData: { buffer: number[]; sampleRate: number; timestamp: number }) => void;
  onTranscriptionResult: (callback: (result: TranscriptionResult) => void) => void;
  onTranscriptionError: (callback: (error: TranscriptionError) => void) => void;
  onTranscriptionStatus: (callback: (status: TranscriptionStatusUpdate) => void) => void;
  removeTranscriptionListeners: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
