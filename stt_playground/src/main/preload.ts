import { contextBridge, ipcRenderer } from 'electron';
import { AudioChunk, TranscriptionResult, TranscriptionError, TranscriptionStatusUpdate, ElectronAPI } from '../shared/types';

console.log('[Preload] Preload script executing...');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
// Note: contextBridge will prevent duplicate exposure automatically
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
    setHotkeyMode: (enabled: boolean) => {
      console.log('[Preload] setHotkeyMode called:', enabled);
      ipcRenderer.send('set-hotkey-mode', enabled);
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
    onToggleRecordingHotkey: (callback: () => void) => {
      ipcRenderer.on('toggle-recording-hotkey', () => {
        try {
          console.log('[Preload] Global hotkey toggle event received');
          callback();
        } catch (error) {
          console.error('[Preload] Error in hotkey toggle callback:', error);
        }
      });
    },

    // Cleanup methods
    removeTranscriptionListeners: () => {
      ipcRenderer.removeAllListeners('transcription-result');
      ipcRenderer.removeAllListeners('transcription-error');
      ipcRenderer.removeAllListeners('transcription-status');
      ipcRenderer.removeAllListeners('toggle-recording-hotkey');
    },
  });

  console.log('[Preload] electronAPI exposed successfully');
} catch (error) {
  console.error('[Preload] Error exposing electronAPI:', error);
}

// Note: ElectronAPI type and Window interface extension are now in src/shared/types.ts
