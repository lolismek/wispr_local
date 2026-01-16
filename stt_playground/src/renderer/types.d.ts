import { TranscriptionResult, TranscriptionError, TranscriptionStatusUpdate } from '../shared/types';

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

export {};
