import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

export interface WhisperResult {
  text: string;
  success: boolean;
  error?: string;
}

/**
 * WhisperServer manages a persistent whisper-server process
 * that keeps the model loaded in memory for fast, consistent transcription
 */
export class WhisperServer {
  private serverProcess: ChildProcess | null = null;
  private binaryPath: string;
  private modelPath: string;
  private port: number = 8765;
  private isReady: boolean = false;
  private processingQueue: Array<() => Promise<void>> = [];
  private isProcessing: boolean = false;

  constructor() {
    // Use whisper-server binary
    this.binaryPath = path.join(process.cwd(), 'whisper', 'whisper.cpp', 'build', 'bin', 'whisper-server');
    this.modelPath = path.join(process.cwd(), 'whisper', 'models', 'ggml-tiny.bin');

    this.verifyPaths();
  }

  private verifyPaths(): void {
    if (!fs.existsSync(this.binaryPath)) {
      throw new Error(`Whisper server binary not found at: ${this.binaryPath}`);
    }

    if (!fs.existsSync(this.modelPath)) {
      throw new Error(`Whisper model not found at: ${this.modelPath}`);
    }

    console.log('[WhisperServer] Paths verified:');
    console.log('  Binary:', this.binaryPath);
    console.log('  Model:', this.modelPath);
  }

  /**
   * Start the persistent whisper-server process
   */
  async start(): Promise<void> {
    if (this.serverProcess) {
      console.log('[WhisperServer] Server already running');
      return;
    }

    console.log('[WhisperServer] Starting server on port', this.port);

    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.modelPath,
        '-p', this.port.toString(),
        '-t', '4', // 4 threads
        // Note: No --convert flag - we pre-convert to WAV with AudioProcessor (no ffmpeg needed)
      ];

      console.log('[WhisperServer] Command:', this.binaryPath, args.join(' '));

      this.serverProcess = spawn(this.binaryPath, args);

      // Track server output
      this.serverProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log('[WhisperServer stdout]', output);

        // Server ready when it starts listening
        if (output.includes('HTTP server listening')) {
          this.isReady = true;
          console.log('[WhisperServer] Server ready!');
          resolve();
        }
      });

      this.serverProcess.stderr?.on('data', (data) => {
        console.log('[WhisperServer stderr]', data.toString());
      });

      this.serverProcess.on('error', (error) => {
        console.error('[WhisperServer] Process error:', error);
        reject(error);
      });

      this.serverProcess.on('exit', (code) => {
        console.log('[WhisperServer] Process exited with code:', code);
        this.isReady = false;
        this.serverProcess = null;
      });

      // Timeout if server doesn't start in 10 seconds
      setTimeout(() => {
        if (!this.isReady) {
          reject(new Error('Server failed to start within 10 seconds'));
        }
      }, 10000);
    });
  }

  /**
   * Stop the whisper-server process
   */
  stop(): void {
    if (this.serverProcess) {
      console.log('[WhisperServer] Stopping server');
      this.serverProcess.kill();
      this.serverProcess = null;
      this.isReady = false;
    }
  }

  /**
   * Transcribe an audio file using the running server
   */
  async transcribe(audioFilePath: string): Promise<WhisperResult> {
    if (!this.isReady) {
      return {
        text: '',
        success: false,
        error: 'Whisper server not ready',
      };
    }

    // Queue processing to avoid concurrent requests
    if (this.isProcessing) {
      console.log('[WhisperServer] Busy, queueing request');
      return new Promise((resolve) => {
        this.processingQueue.push(async () => {
          const result = await this._transcribe(audioFilePath);
          resolve(result);
        });
      });
    }

    return this._transcribe(audioFilePath);
  }

  private async _transcribe(audioFilePath: string): Promise<WhisperResult> {
    this.isProcessing = true;

    try {
      console.log('[WhisperServer] Transcribing:', audioFilePath);

      // Read audio file
      const audioBuffer = fs.readFileSync(audioFilePath);

      // Send to server
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/wav' });
      formData.append('file', blob, 'audio.wav');

      const response = await axios.post(`http://localhost:${this.port}/inference`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 30000, // 30 second timeout
      });

      const text = response.data.text || '';
      console.log('[WhisperServer] Transcription result:', text);

      return {
        text: text.trim(),
        success: true,
      };
    } catch (error) {
      console.error('[WhisperServer] Transcription failed:', error);
      return {
        text: '',
        success: false,
        error: (error as Error).message,
      };
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  private processNext(): void {
    if (this.processingQueue.length > 0) {
      const nextTask = this.processingQueue.shift();
      if (nextTask) {
        nextTask();
      }
    }
  }

  isServerReady(): boolean {
    return this.isReady;
  }

  getQueueSize(): number {
    return this.processingQueue.length;
  }
}
