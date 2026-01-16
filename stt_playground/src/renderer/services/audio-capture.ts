import { VADConfig, VADStateUpdate, DEFAULT_VAD_CONFIG } from '../../shared/types';

export type { VADConfig, VADStateUpdate };

export class AudioCaptureService {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;

  private readonly targetSampleRate = 16000;
  private vadConfig: VADConfig;

  private onChunkReady: ((chunk: Float32Array, sampleRate: number, timestamp: number, vadMetadata?: any) => void) | null = null;
  private onVADStateChange: ((state: VADStateUpdate) => void) | null = null;

  constructor(vadConfig?: Partial<VADConfig>) {
    this.vadConfig = { ...DEFAULT_VAD_CONFIG, ...vadConfig };
  }

  /**
   * Start capturing audio from microphone
   */
  async start(
    onChunkReady: (chunk: Float32Array, sampleRate: number, timestamp: number, vadMetadata?: any) => void,
    onVADStateChange?: (state: VADStateUpdate) => void
  ): Promise<void> {
    this.onChunkReady = onChunkReady;
    this.onVADStateChange = onVADStateChange || null;

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
          const messageType = event.data.type;

          if (messageType === 'audio-chunk') {
            // Audio chunk ready for transcription
            const { audio, sampleRate, timestamp, vadMetadata } = event.data;
            if (audio && audio.length > 0 && this.onChunkReady) {
              // Convert to Float32Array if needed
              const chunk = audio instanceof Float32Array ? audio : new Float32Array(audio);
              console.log(`[AudioCapture] Received speech chunk: ${chunk.length} samples (${(chunk.length / sampleRate).toFixed(2)}s)`);
              this.onChunkReady(chunk, sampleRate, timestamp, vadMetadata);
            }
          } else if (messageType === 'vad-state') {
            // VAD state update for UI feedback
            const { state, energy, speechDuration, timestamp } = event.data;
            if (this.onVADStateChange) {
              this.onVADStateChange({ state, energy, speechDuration, timestamp });
            }
          }
        } catch (error) {
          console.error('[AudioCapture] Error processing worklet message:', error);
        }
      };

      // Send initial VAD configuration to worklet
      console.log('[AudioCapture] Sending VAD configuration to worklet:', this.vadConfig);
      this.audioWorkletNode.port.postMessage({
        type: 'config',
        config: this.vadConfig
      });

      // Connect nodes
      this.mediaStreamSource.connect(this.audioWorkletNode);
      this.audioWorkletNode.connect(this.audioContext.destination);

      console.log('[AudioCapture] Audio pipeline connected with VAD');
      console.log('  Sample rate:', this.audioContext.sampleRate);
      console.log('  VAD config:', this.vadConfig);
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

      // Reset callbacks
      this.onChunkReady = null;
      this.onVADStateChange = null;

      console.log('[AudioCapture] Audio capture stopped');
    } catch (error) {
      console.error('[AudioCapture] Error stopping:', error);
    }
  }

  /**
   * Update VAD configuration dynamically
   */
  updateVADConfig(config: Partial<VADConfig>): void {
    this.vadConfig = { ...this.vadConfig, ...config };
    console.log('[AudioCapture] Updating VAD config:', this.vadConfig);

    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({
        type: 'config',
        config: this.vadConfig
      });
    }
  }

  /**
   * Get current VAD configuration
   */
  getVADConfig(): VADConfig {
    return { ...this.vadConfig };
  }

  /**
   * Check if currently capturing
   */
  isCapturing(): boolean {
    return this.audioContext !== null && this.mediaStream !== null;
  }
}
