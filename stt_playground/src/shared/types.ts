// Shared types for IPC communication

export interface AudioChunk {
  buffer: Float32Array;
  sampleRate: number;
  timestamp: number;
  vadMetadata?: {
    speechDuration: number;
    avgEnergy: number;
    reason: 'silence_detected' | 'max_duration_reached';
  };
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

// Voice Activity Detection (VAD) types
export interface VADConfig {
  speechThreshold: number;
  silenceThreshold: number;
  silenceDuration: number;
  minSpeechDuration: number;
  maxSpeechDuration: number;
  energySmoothingFactor: number;
  preSpeechPadding: number;
  postSpeechPadding: number;
}

export type VADState = 'LISTENING' | 'SPEECH_DETECTED' | 'SPEAKING';

export interface VADStateUpdate {
  state: VADState;
  energy: number;
  speechDuration: number;
  timestamp: number;
}

export const DEFAULT_VAD_CONFIG: VADConfig = {
  speechThreshold: 0.01,
  silenceThreshold: 0.005,
  silenceDuration: 700,
  minSpeechDuration: 400,
  maxSpeechDuration: 25000,
  energySmoothingFactor: 0.25,
  preSpeechPadding: 250,
  postSpeechPadding: 300
};
