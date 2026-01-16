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
  private isWarmedUp: boolean = false;

  constructor() {
    // Paths relative to project root
    this.binaryPath = path.join(process.cwd(), 'whisper', 'binaries', 'whisper-cpp');
    // Using Tiny model for 3-4x faster transcription (vs Small model)
    // Trade-off: Slightly less accurate, but much faster response time
    this.modelPath = path.join(process.cwd(), 'whisper', 'models', 'ggml-tiny.bin');

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
   * Pre-warm Whisper model by running a dummy transcription
   * This loads the model into memory to avoid cold start delay on first real transcription
   */
  async warmUp(): Promise<void> {
    if (this.isWarmedUp) {
      console.log('[WhisperRunner] Already warmed up, skipping');
      return;
    }

    console.log('[WhisperRunner] Warming up model (loading into memory)...');
    const startTime = Date.now();

    try {
      // Create a minimal silent WAV file (0.5 seconds at 16kHz)
      const silentWavPath = path.join(process.cwd(), 'temp_warmup.wav');
      this.createSilentWav(silentWavPath, 0.5);

      // Run dummy transcription to load model
      await this._transcribe(silentWavPath);

      // Clean up temp file
      if (fs.existsSync(silentWavPath)) {
        fs.unlinkSync(silentWavPath);
      }

      const duration = Date.now() - startTime;
      console.log(`[WhisperRunner] Warm-up complete in ${duration}ms - model loaded into memory`);
      this.isWarmedUp = true;
    } catch (error) {
      console.error('[WhisperRunner] Warm-up failed:', error);
      // Don't throw - first transcription will just be slower
    }
  }

  /**
   * Create a minimal silent WAV file for warm-up
   */
  private createSilentWav(filePath: string, durationSeconds: number): void {
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const dataSize = numSamples * numChannels * (bitsPerSample / 8);

    const buffer = Buffer.alloc(44 + dataSize);

    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Silent audio data (all zeros) - already initialized by Buffer.alloc

    fs.writeFileSync(filePath, buffer);
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
