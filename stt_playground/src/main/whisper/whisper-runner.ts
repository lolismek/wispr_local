import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface WhisperResult {
  text: string;
  success: boolean;
  error?: string;
}

export class WhisperRunner {
  private binaryPath: string;
  private modelPath: string;
  private isProcessing: boolean = false;
  private processQueue: Array<() => Promise<void>> = [];

  constructor() {
    // Paths relative to project root
    this.binaryPath = path.join(process.cwd(), 'whisper', 'binaries', 'whisper-cpp');
    this.modelPath = path.join(process.cwd(), 'whisper', 'models', 'ggml-small.bin');

    this.verifyPaths();
  }

  /**
   * Verify that whisper.cpp binary and model exist
   */
  private verifyPaths(): void {
    if (!fs.existsSync(this.binaryPath)) {
      throw new Error(`Whisper binary not found at: ${this.binaryPath}`);
    }

    if (!fs.existsSync(this.modelPath)) {
      throw new Error(`Whisper model not found at: ${this.modelPath}`);
    }

    console.log('Whisper.cpp paths verified:');
    console.log('  Binary:', this.binaryPath);
    console.log('  Model:', this.modelPath);
  }

  /**
   * Transcribe an audio file using whisper.cpp
   * @param audioFilePath Path to the WAV file to transcribe
   * @returns Promise with transcription result
   */
  async transcribe(audioFilePath: string): Promise<WhisperResult> {
    // Add to queue if already processing
    if (this.isProcessing) {
      console.log('WhisperRunner busy, queueing request');
      return new Promise((resolve) => {
        this.processQueue.push(async () => {
          const result = await this._transcribe(audioFilePath);
          resolve(result);
        });
      });
    }

    return this._transcribe(audioFilePath);
  }

  /**
   * Internal transcription method
   */
  private async _transcribe(audioFilePath: string): Promise<WhisperResult> {
    this.isProcessing = true;

    try {
      const result = await this.runWhisperProcess(audioFilePath);
      return result;
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  /**
   * Process next item in queue
   */
  private processNext(): void {
    if (this.processQueue.length > 0) {
      const nextTask = this.processQueue.shift();
      if (nextTask) {
        nextTask();
      }
    }
  }

  /**
   * Spawn whisper.cpp process and parse output
   */
  private async runWhisperProcess(audioFilePath: string): Promise<WhisperResult> {
    return new Promise((resolve) => {
      const args = [
        '-m', this.modelPath,
        '-f', audioFilePath,
        '-nt', // No timestamps in output
        '-t', '4', // Use 4 threads
      ];

      console.log('Starting whisper.cpp:', this.binaryPath, args.join(' '));

      const process = spawn(this.binaryPath, args);

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        console.log('Whisper process closed with code:', code);
        console.log('STDOUT:', stdout);
        console.log('STDERR:', stderr);

        if (code === 0) {
          const text = this.parseWhisperOutput(stdout);
          console.log('Parsed transcription text:', text);
          resolve({
            text,
            success: true,
          });
        } else {
          console.error('Whisper process failed with code:', code);
          resolve({
            text: '',
            success: false,
            error: `Whisper process exited with code ${code}: ${stderr}`,
          });
        }
      });

      process.on('error', (error) => {
        console.error('Failed to start whisper process:', error);
        resolve({
          text: '',
          success: false,
          error: `Failed to start whisper: ${error.message}`,
        });
      });
    });
  }

  /**
   * Parse transcription text from whisper.cpp output
   * Whisper.cpp outputs the transcription after processing info
   */
  private parseWhisperOutput(output: string): string {
    const lines = output.split('\n');

    // Find lines that contain the actual transcription
    // Whisper outputs the transcription with timestamps or without depending on flags
    // Since we use --no-timestamps, the transcription is in plain text after processing info

    // Look for lines that don't start with '[' (processing info)
    const transcriptionLines = lines
      .filter((line) => {
        const trimmed = line.trim();
        return (
          trimmed.length > 0 &&
          !trimmed.startsWith('[') &&
          !trimmed.includes('whisper_') &&
          !trimmed.includes('system_info') &&
          !trimmed.includes('sampling') &&
          !trimmed.includes('main:')
        );
      })
      .map((line) => line.trim());

    return transcriptionLines.join(' ').trim();
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.processQueue.length;
  }

  /**
   * Check if currently processing
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }
}
