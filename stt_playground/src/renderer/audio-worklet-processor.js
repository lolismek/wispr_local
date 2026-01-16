// AudioWorklet processor with Voice Activity Detection (VAD)
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // VAD Configuration (default values)
    this.config = {
      speechThreshold: 0.01,
      silenceThreshold: 0.005,
      silenceDuration: 700,           // ms
      minSpeechDuration: 400,         // ms
      maxSpeechDuration: 25000,       // ms
      energySmoothingFactor: 0.25,
      preSpeechPadding: 250,          // ms
      postSpeechPadding: 300          // ms
    };

    // VAD State
    this.state = 'LISTENING';
    this.smoothedEnergy = 0;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.silenceStartTime = 0;

    // Ring buffer for pre-speech padding
    // At 16kHz, 500ms = 8000 samples (enough for 250ms padding with margin)
    this.ringBufferSize = 8000;
    this.ringBuffer = new Float32Array(this.ringBufferSize);
    this.ringBufferIndex = 0;
    this.ringBufferFilled = false;

    // Audio buffer for current speech segment
    this.audioBuffer = [];
    this.totalSamplesBuffered = 0;

    // Sample rate (will be set on first process call)
    this.sampleRate = 16000;

    // Listen for configuration updates
    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        this.updateConfig(event.data.config);
      }
    };

    console.log('[AudioWorklet VAD] Processor initialized with config:', this.config);
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log('[AudioWorklet VAD] Configuration updated:', this.config);
  }

  // Calculate RMS (Root Mean Square) energy of audio samples
  calculateRMS(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  // Update ring buffer with new samples (for pre-speech padding)
  updateRingBuffer(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.ringBuffer[this.ringBufferIndex] = samples[i];
      this.ringBufferIndex = (this.ringBufferIndex + 1) % this.ringBufferSize;

      if (this.ringBufferIndex === 0) {
        this.ringBufferFilled = true;
      }
    }
  }

  // Get samples from ring buffer for pre-speech padding
  getRingBufferSamples(durationMs) {
    const numSamples = Math.min(
      Math.floor((durationMs / 1000) * this.sampleRate),
      this.ringBufferFilled ? this.ringBufferSize : this.ringBufferIndex
    );

    const samples = new Float32Array(numSamples);
    let readIndex = (this.ringBufferIndex - numSamples + this.ringBufferSize) % this.ringBufferSize;

    for (let i = 0; i < numSamples; i++) {
      samples[i] = this.ringBuffer[readIndex];
      readIndex = (readIndex + 1) % this.ringBufferSize;
    }

    return samples;
  }

  // Add samples to audio buffer
  addToAudioBuffer(samples) {
    this.audioBuffer.push(new Float32Array(samples));
    this.totalSamplesBuffered += samples.length;
  }

  // Get speech duration in milliseconds
  getSpeechDuration() {
    return (this.totalSamplesBuffered / this.sampleRate) * 1000;
  }

  // Emit audio chunk with metadata
  emitChunk(reason) {
    if (this.audioBuffer.length === 0) {
      console.log('[AudioWorklet VAD] No audio to emit');
      return;
    }

    // Add post-speech padding from ring buffer
    const postPaddingSamples = this.getRingBufferSamples(this.config.postSpeechPadding);
    if (postPaddingSamples.length > 0) {
      this.audioBuffer.push(postPaddingSamples);
      this.totalSamplesBuffered += postPaddingSamples.length;
    }

    // Concatenate all buffered chunks into single Float32Array
    const totalSamples = new Float32Array(this.totalSamplesBuffered);
    let offset = 0;
    for (const chunk of this.audioBuffer) {
      totalSamples.set(chunk, offset);
      offset += chunk.length;
    }

    const speechDuration = this.getSpeechDuration();
    const avgEnergy = this.smoothedEnergy;

    console.log(`[AudioWorklet VAD] Emitting chunk: ${totalSamples.length} samples, ${speechDuration.toFixed(0)}ms, reason: ${reason}`);

    // Send audio chunk to main thread
    this.port.postMessage({
      type: 'audio-chunk',
      audio: totalSamples,
      sampleRate: this.sampleRate,
      timestamp: Date.now(),
      vadMetadata: {
        speechDuration,
        avgEnergy,
        reason
      }
    });

    // Reset buffers
    this.audioBuffer = [];
    this.totalSamplesBuffered = 0;
  }

  // Send VAD state update to main thread
  sendStateUpdate(energy) {
    this.port.postMessage({
      type: 'vad-state',
      state: this.state,
      energy: energy,
      speechDuration: this.state === 'SPEAKING' || this.state === 'SPEECH_DETECTED'
        ? this.getSpeechDuration()
        : 0,
      timestamp: Date.now()
    });
  }

  // Process VAD state machine
  processStateMachine(samples, energy, currentTime) {
    // Apply exponential smoothing to energy
    this.smoothedEnergy =
      this.config.energySmoothingFactor * energy +
      (1 - this.config.energySmoothingFactor) * this.smoothedEnergy;

    const samplesMs = (samples.length / this.sampleRate) * 1000;

    switch (this.state) {
      case 'LISTENING':
        // Waiting for speech to start
        if (this.smoothedEnergy > this.config.speechThreshold) {
          console.log(`[AudioWorklet VAD] Speech detected! Energy: ${this.smoothedEnergy.toFixed(4)}`);
          this.state = 'SPEECH_DETECTED';
          this.speechStartTime = currentTime;
          this.lastSpeechTime = currentTime;

          // Add pre-speech padding from ring buffer
          const prePaddingSamples = this.getRingBufferSamples(this.config.preSpeechPadding);
          if (prePaddingSamples.length > 0) {
            this.addToAudioBuffer(prePaddingSamples);
          }

          // Add current samples
          this.addToAudioBuffer(samples);
          this.sendStateUpdate(this.smoothedEnergy);
        }
        break;

      case 'SPEECH_DETECTED':
        // Verify it's not just a brief noise
        this.addToAudioBuffer(samples);

        if (this.smoothedEnergy > this.config.speechThreshold) {
          this.lastSpeechTime = currentTime;
        }

        const detectionDuration = currentTime - this.speechStartTime;

        if (detectionDuration >= this.config.minSpeechDuration) {
          // Confirmed as speech
          console.log(`[AudioWorklet VAD] Speech confirmed after ${detectionDuration.toFixed(0)}ms`);
          this.state = 'SPEAKING';
          this.sendStateUpdate(this.smoothedEnergy);
        } else if (this.smoothedEnergy < this.config.silenceThreshold) {
          // False alarm - just a brief noise
          const silenceDuration = currentTime - this.lastSpeechTime;
          if (silenceDuration >= this.config.silenceDuration / 2) {
            console.log(`[AudioWorklet VAD] False alarm - discarding buffer`);
            this.state = 'LISTENING';
            this.audioBuffer = [];
            this.totalSamplesBuffered = 0;
            this.sendStateUpdate(this.smoothedEnergy);
          }
        }
        break;

      case 'SPEAKING':
        // Active speech - continue buffering
        this.addToAudioBuffer(samples);

        if (this.smoothedEnergy > this.config.silenceThreshold) {
          this.lastSpeechTime = currentTime;
        }

        const speechDuration = this.getSpeechDuration();
        const silenceDuration = currentTime - this.lastSpeechTime;

        // Check for speech end conditions
        if (silenceDuration >= this.config.silenceDuration) {
          // User stopped speaking
          console.log(`[AudioWorklet VAD] Silence detected for ${silenceDuration.toFixed(0)}ms, ending speech`);
          this.emitChunk('silence_detected');
          this.state = 'LISTENING';
          this.sendStateUpdate(this.smoothedEnergy);
        } else if (speechDuration >= this.config.maxSpeechDuration) {
          // Maximum duration reached
          console.log(`[AudioWorklet VAD] Max duration reached (${speechDuration.toFixed(0)}ms), forcing chunk`);
          this.emitChunk('max_duration_reached');
          this.state = 'LISTENING';
          this.sendStateUpdate(this.smoothedEnergy);
        }

        // Send periodic state updates while speaking (every ~200ms)
        if (Math.random() < 0.1) { // ~10% chance per frame = ~200ms intervals
          this.sendStateUpdate(this.smoothedEnergy);
        }
        break;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (!input || input.length === 0) {
      return true;
    }

    const channelData = input[0]; // Get first channel (mono)

    if (!channelData || channelData.length === 0) {
      return true;
    }

    // Get current time from context (in milliseconds)
    const currentTime = currentFrame / sampleRate * 1000;

    // Calculate energy
    const energy = this.calculateRMS(channelData);

    // Always update ring buffer (for pre-speech padding)
    this.updateRingBuffer(channelData);

    // Process VAD state machine
    this.processStateMachine(channelData, energy, currentTime);

    return true; // Keep processor alive
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
