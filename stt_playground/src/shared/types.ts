// Shared types for IPC communication

export interface AudioChunk {
  buffer: Float32Array;
  sampleRate: number;
  timestamp: number;
}

export interface TranscriptionResult {
  text: string;
  chunkId: number;
  isFinal: boolean;
}

export interface TranscriptionError {
  error: string;
  chunkId?: number;
}

export type TranscriptionStatus = 'idle' | 'recording' | 'processing' | 'ready' | 'error';

export interface TranscriptionStatusUpdate {
  status: TranscriptionStatus;
  message?: string;
}

export interface WhisperConfig {
  modelPath: string;
  binaryPath: string;
  chunkDuration: number;
  sampleRate: number;
  language?: string;
}
