export class AudioCaptureService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;

  private audioBuffer: Float32Array[] = [];
  private readonly targetSampleRate = 16000;
  private readonly chunkDurationSeconds = 3;
  private samplesCollected = 0;
  private readonly samplesPerChunk: number;

  private onChunkReady: ((chunk: Float32Array, sampleRate: number, timestamp: number) => void) | null = null;

  constructor() {
    this.samplesPerChunk = this.chunkDurationSeconds * this.targetSampleRate;
  }

  /**
   * Start capturing audio from microphone
   */
  async start(onChunkReady: (chunk: Float32Array, sampleRate: number, timestamp: number) => void): Promise<void> {
    this.onChunkReady = onChunkReady;

    try {
      console.log('[AudioCapture] Requesting microphone access...');

      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: this.targetSampleRate,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log('[AudioCapture] Microphone access granted');

      // Create audio context with target sample rate
      this.audioContext = new AudioContext({
        sampleRate: this.targetSampleRate,
      });

      console.log('[AudioCapture] AudioContext created, sample rate:', this.audioContext.sampleRate);

      // Load audio worklet module
      console.log('[AudioCapture] Loading AudioWorklet module...');
      await this.audioContext.audioWorklet.addModule('audio-worklet-processor.js');
      console.log('[AudioCapture] AudioWorklet module loaded');

      // Create media stream source
      this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);
      console.log('[AudioCapture] MediaStreamSource created');

      // Create audio worklet node
      this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-capture-processor');
      console.log('[AudioCapture] AudioWorkletNode created');

      // Handle messages from the worklet
      this.audioWorkletNode.port.onmessage = (event) => {
        try {
          const { audio, length } = event.data;
          if (audio && length > 0) {
            this.processAudioBuffer(audio);
          }
        } catch (error) {
          console.error('[AudioCapture] Error processing worklet message:', error);
        }
      };

      // Connect nodes
      this.mediaStreamSource.connect(this.audioWorkletNode);
      this.audioWorkletNode.connect(this.audioContext.destination);

      console.log('[AudioCapture] Audio pipeline connected');
      console.log('  Sample rate:', this.audioContext.sampleRate);
      console.log('  Chunk duration:', this.chunkDurationSeconds, 'seconds');
      console.log('  Samples per chunk:', this.samplesPerChunk);
      console.log('  Audio context state:', this.audioContext.state);

      // Resume AudioContext if it's suspended
      if (this.audioContext.state === 'suspended') {
        console.log('[AudioCapture] Resuming suspended AudioContext...');
        await this.audioContext.resume();
        console.log('[AudioCapture] AudioContext resumed, state:', this.audioContext.state);
      }
    } catch (error) {
      console.error('[AudioCapture] Failed to start audio capture:', error);
      throw new Error(`Microphone access denied or failed: ${(error as Error).message}`);
    }
  }

  /**
   * Stop capturing audio
   */
  stop(): void {
    console.log('[AudioCapture] Stopping audio capture');

    try {
      // Disconnect and clean up
      if (this.audioWorkletNode) {
        this.audioWorkletNode.port.onmessage = null;
        this.audioWorkletNode.disconnect();
        this.audioWorkletNode = null;
      }

      if (this.mediaStreamSource) {
        this.mediaStreamSource.disconnect();
        this.mediaStreamSource = null;
      }

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => track.stop());
        this.mediaStream = null;
      }

      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }

      // Reset buffers
      this.audioBuffer = [];
      this.samplesCollected = 0;
      this.onChunkReady = null;

      console.log('[AudioCapture] Audio capture stopped');
    } catch (error) {
      console.error('[AudioCapture] Error stopping:', error);
    }
  }

  /**
   * Process incoming audio buffer from AudioWorklet
   */
  private processAudioBuffer(channelData: Float32Array): void {
    // Add to buffer
    this.audioBuffer.push(new Float32Array(channelData));
    this.samplesCollected += channelData.length;

    // Log progress occasionally (every ~100ms worth of data)
    if (this.samplesCollected % 1600 === 0) {
      console.log(`[AudioCapture] Buffer: ${this.samplesCollected}/${this.samplesPerChunk} samples`);
    }

    // Check if we have enough samples for a chunk
    if (this.samplesCollected >= this.samplesPerChunk) {
      console.log('[AudioCapture] Enough samples collected, emitting chunk...');
      this.emitChunk();
    }
  }

  /**
   * Combine buffered audio and emit as chunk
   */
  private emitChunk(): void {
    if (!this.onChunkReady || this.audioBuffer.length === 0) {
      return;
    }

    // Combine all buffers into single Float32Array
    const chunk = new Float32Array(this.samplesCollected);
    let offset = 0;

    for (const buffer of this.audioBuffer) {
      chunk.set(buffer, offset);
      offset += buffer.length;
    }

    // Emit the chunk
    const timestamp = Date.now();
    console.log(`[AudioCapture] Emitting chunk: ${this.samplesCollected} samples (${(this.samplesCollected / this.targetSampleRate).toFixed(2)}s)`);

    this.onChunkReady(chunk, this.targetSampleRate, timestamp);

    // Reset buffers
    this.audioBuffer = [];
    this.samplesCollected = 0;
  }

  /**
   * Check if currently capturing
   */
  isCapturing(): boolean {
    return this.audioContext !== null && this.mediaStream !== null;
  }
}
