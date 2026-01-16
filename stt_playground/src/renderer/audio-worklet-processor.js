// AudioWorklet processor for capturing audio
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    console.log('[AudioWorklet] Processor initialized');
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input.length > 0) {
      const channelData = input[0]; // Get first channel (mono)

      if (channelData && channelData.length > 0) {
        // Send audio data to main thread
        this.port.postMessage({
          audio: channelData,
          length: channelData.length
        });
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
