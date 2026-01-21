import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class AudioProcessor {
  /**
   * Converts Float32Array audio buffer to WAV format and writes to temp file
   * @param buffer Audio samples as Float32Array (-1.0 to 1.0)
   * @param sampleRate Sample rate (e.g., 16000)
   * @param timestamp Timestamp for unique file naming
   * @returns Path to the created WAV file
   */
  static async convertToWAV(
    buffer: Float32Array,
    sampleRate: number,
    timestamp: number
  ): Promise<string> {
    // Convert Float32Array to Int16Array (16-bit PCM)
    const int16Buffer = this.float32ToInt16(buffer);

    // Create WAV file header
    const wavBuffer = this.createWAVFile(int16Buffer, sampleRate);

    // Write to temp file
    const tempFilePath = path.join(os.tmpdir(), `whisper_chunk_${timestamp}.wav`);
    await fs.promises.writeFile(tempFilePath, wavBuffer);

    console.log(`Created WAV file: ${tempFilePath} (${wavBuffer.length} bytes)`);

    return tempFilePath;
  }

  /**
   * Converts Float32Array (-1.0 to 1.0) to Int16Array (-32768 to 32767)
   */
  private static float32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);

    for (let i = 0; i < float32Array.length; i++) {
      // Clamp the value between -1 and 1
      const clamped = Math.max(-1, Math.min(1, float32Array[i]));
      // Convert to 16-bit integer
      int16Array[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    return int16Array;
  }

  /**
   * Creates a complete WAV file buffer with header and audio data
   */
  private static createWAVFile(samples: Int16Array, sampleRate: number): Buffer {
    const numChannels = 1; // Mono
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const fileSize = 44 + dataSize; // 44 bytes for WAV header

    const buffer = Buffer.alloc(fileSize);
    let offset = 0;

    // RIFF chunk descriptor
    buffer.write('RIFF', offset);
    offset += 4;
    buffer.writeUInt32LE(fileSize - 8, offset); // File size - 8
    offset += 4;
    buffer.write('WAVE', offset);
    offset += 4;

    // fmt sub-chunk
    buffer.write('fmt ', offset);
    offset += 4;
    buffer.writeUInt32LE(16, offset); // Subchunk1Size (16 for PCM)
    offset += 4;
    buffer.writeUInt16LE(1, offset); // AudioFormat (1 for PCM)
    offset += 2;
    buffer.writeUInt16LE(numChannels, offset); // NumChannels
    offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); // SampleRate
    offset += 4;
    buffer.writeUInt32LE(byteRate, offset); // ByteRate
    offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); // BlockAlign
    offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset); // BitsPerSample
    offset += 2;

    // data sub-chunk
    buffer.write('data', offset);
    offset += 4;
    buffer.writeUInt32LE(dataSize, offset); // Subchunk2Size
    offset += 4;

    // Write audio samples
    for (let i = 0; i < samples.length; i++) {
      buffer.writeInt16LE(samples[i], offset);
      offset += 2;
    }

    return buffer;
  }

  /**
   * Deletes a temporary WAV file
   */
  static async cleanupTempFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
      console.log(`Cleaned up temp file: ${filePath}`);
    } catch (error: any) {
      // Ignore if file doesn't exist (already deleted)
      if (error.code !== 'ENOENT') {
        console.error(`Failed to cleanup temp file ${filePath}:`, error);
      }
    }
  }

  /**
   * Cleans up all temp whisper files
   */
  static async cleanupAllTempFiles(): Promise<void> {
    const tempDir = os.tmpdir();
    const files = await fs.promises.readdir(tempDir);

    const whisperFiles = files.filter((file) => file.startsWith('whisper_chunk_'));

    for (const file of whisperFiles) {
      await this.cleanupTempFile(path.join(tempDir, file));
    }
  }
}
