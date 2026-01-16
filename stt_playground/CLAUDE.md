# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Voice-to-Text POC: An Electron desktop application that captures microphone input and transcribes speech using Whisper.cpp (local processing, no cloud APIs). Built with TypeScript, targeting macOS.

## Essential Commands

### Initial Setup
```bash
npm install                    # Install dependencies
npm run setup-whisper          # Clone, compile whisper.cpp, and download Small model (~466MB)
```

**Note**: Requires `cmake` (`brew install cmake` on macOS). The setup script uses CMake build system, not make.

### Development Workflow
```bash
npm run build                  # Build all: main process, preload, renderer (webpack)
npm start                      # Run Electron app (must build first)
npm run dev                    # Build in dev mode and start
```

### Debugging
- Open DevTools in running app: `Cmd + Option + I` (macOS)
- Console logs from AudioWorklet VAD appear in browser console, not terminal
- Main process logs appear in terminal

## Architecture Overview

### Electron Process Model

**Three separate processes with distinct build configs:**

1. **Main Process** (`src/main/`) - Node.js environment
   - Entry: `src/main/index.ts`
   - Builds to: `dist/main/index.js`
   - Creates BrowserWindow, manages app lifecycle
   - Handles IPC from renderer, runs Whisper.cpp via child_process

2. **Preload Script** (`src/main/preload.ts`) - Isolated context bridge
   - Builds to: `dist/main/preload.js`
   - Exposes secure IPC methods to renderer via `contextBridge`
   - Bridge between isolated renderer and main process

3. **Renderer Process** (`src/renderer/`) - Browser environment
   - Entry: `src/renderer/index.ts`
   - Builds to: `dist/renderer/renderer.js`
   - UI logic, audio capture, user interactions
   - No direct Node.js access (context isolation enabled)

**Critical**: Each process has its own tsconfig and webpack config. Don't import Node.js modules in renderer code.

### Audio Pipeline with VAD

```
Microphone → AudioWorkletNode → VAD State Machine → IPC → Main Process → Whisper.cpp
```

**Key Flow:**

1. **AudioWorklet** (`src/renderer/audio-worklet-processor.js`)
   - Runs on dedicated audio thread (not main thread)
   - Implements Voice Activity Detection (VAD) using RMS energy calculation
   - State machine: LISTENING → SPEECH_DETECTED → SPEAKING → emit chunk
   - Detects speech/silence, buffers audio, emits chunks when user pauses (700ms default)
   - Includes pre-speech (250ms) and post-speech (300ms) padding via ring buffer

2. **AudioCaptureService** (`src/renderer/services/audio-capture.ts`)
   - Manages AudioContext, MediaStream, AudioWorkletNode
   - Receives two message types from worklet:
     - `audio-chunk`: Speech segments ready for transcription
     - `vad-state`: Real-time state updates for UI feedback
   - Configurable VAD parameters (thresholds, durations)

3. **IPC Communication** (`src/main/ipc/transcription.ts`)
   - Handles `process-audio-chunk` events
   - Converts Float32Array → WAV file (16-bit PCM, 16kHz mono)
   - Spawns `whisper-cpp` process with model
   - Parses stdout for transcription text
   - Sends results back to renderer

4. **WhisperRunner** (`src/main/whisper/whisper-runner.ts`)
   - Process execution (not native bindings)
   - Sequential processing queue to avoid resource contention
   - Spawns: `whisper-cpp -m model.bin -f audio.wav -nt -t 4`
   - Cleans up temp WAV files after transcription

### VAD (Voice Activity Detection) System

**Replaces fixed 3-second chunking with intelligent speech detection.**

**Configuration** (`src/shared/types.ts` - `DEFAULT_VAD_CONFIG`):
```typescript
{
  speechThreshold: 0.01,        // RMS energy to detect speech
  silenceThreshold: 0.005,      // RMS energy for silence
  silenceDuration: 700,         // ms of silence to end speech
  minSpeechDuration: 400,       // ms minimum to avoid false positives
  maxSpeechDuration: 25000,     // ms maximum, forces chunk for long speech
  energySmoothingFactor: 0.25,  // Exponential smoothing dampens noise spikes
  preSpeechPadding: 250,        // ms captured before speech starts (ring buffer)
  postSpeechPadding: 300        // ms captured after speech ends
}
```

**Benefits:**
- 50-60% latency reduction (transcription starts ~700ms after user stops speaking)
- 70-80% less CPU usage (silence not transcribed)
- Natural sentence boundaries preserved

**How it works:**
- Runs entirely in AudioWorklet (audio thread, no main thread blocking)
- Calculates RMS energy per frame (128 samples at 16kHz)
- Applies exponential smoothing to filter noise spikes
- Ring buffer stores last 8000 samples for pre-speech padding
- Emits chunks on: silence detected (700ms) OR max duration (25s)

### Deduplication Logic

**Located in**: `src/renderer/index.ts` - `appendTranscription()` function

**Problem**: VAD chunks may have overlapping audio at boundaries, causing duplicate transcriptions.

**Solution**: Word-level overlap detection
- Compares last 10 words of existing text with beginning of new text
- Finds maximum overlap (case-insensitive)
- Removes duplicate words from new transcription
- Appends only unique content

**Example**:
```
Existing: "Hello world how are"
New:      "are you today"
→ Detects "are" overlap, appends only "you today"
```

## Key Architectural Decisions

### Why Process Execution for Whisper.cpp?
- Simpler than native bindings (no node-gyp, no compilation per platform)
- Easier debugging (can run whisper-cpp manually)
- Isolation: crashes don't bring down Electron
- Easy to swap for cloud APIs later (same interface)

### Why AudioWorkletNode (not ScriptProcessorNode)?
- ScriptProcessorNode is deprecated and causes segfaults in Electron 28
- AudioWorklet runs on dedicated audio thread (low latency, no main thread blocking)
- Better performance for real-time audio processing

### Why 16kHz Sample Rate?
- Sufficient for speech recognition (human speech: 80Hz-8kHz)
- Reduces file size by 66% vs 48kHz
- Whisper models trained on 16kHz audio

### Why Sequential Processing Queue?
- Prevents spawning multiple whisper-cpp processes simultaneously
- Avoids CPU contention (whisper.cpp is CPU-intensive: 30-50% per process)
- Maintains order of transcriptions

## File Structure Reference

```
src/
├── main/                          # Node.js environment (main process)
│   ├── index.ts                  # App entry, creates window, registers IPC
│   ├── window.ts                 # BrowserWindow configuration
│   ├── preload.ts                # IPC bridge (contextBridge)
│   ├── ipc/
│   │   └── transcription.ts      # IPC handlers for audio chunks
│   └── whisper/
│       ├── whisper-runner.ts     # Spawns whisper-cpp process, parses output
│       └── audio-processor.ts    # Float32Array → WAV conversion
├── renderer/                      # Browser environment (renderer process)
│   ├── index.html                # UI layout
│   ├── index.ts                  # UI logic, event handlers, deduplication
│   ├── audio-worklet-processor.js # VAD algorithm (runs on audio thread)
│   ├── services/
│   │   └── audio-capture.ts      # Manages AudioContext, AudioWorklet, VAD config
│   └── styles/
│       └── main.css              # Styling
└── shared/
    └── types.ts                  # TypeScript interfaces for IPC, VAD config

whisper/
├── binaries/
│   └── whisper-cpp               # Compiled binary (created by setup script)
└── models/
    └── ggml-small.bin            # Whisper Small model (downloaded by setup script)

scripts/
└── setup-whisper.sh              # Clones whisper.cpp, compiles with CMake, downloads model
```

## Common Issues

### Build fails with TypeScript errors
- Three separate tsconfigs: `tsconfig.main.json`, `tsconfig.renderer.json`, `tsconfig.json`
- Ensure you're not importing Node.js modules in renderer code
- Main/preload can use Node.js, renderer cannot (context isolation)

### "Whisper binary not found" error
- Run `npm run setup-whisper` first
- Verify `whisper/binaries/whisper-cpp` and `whisper/models/ggml-small.bin` exist
- Binary path is relative to project root (uses `process.cwd()`)

### AudioWorklet not loading
- `audio-worklet-processor.js` must be copied to `dist/renderer/` by webpack
- Check `CopyWebpackPlugin` config in `webpack.config.js`
- File is loaded via: `audioContext.audioWorklet.addModule('audio-worklet-processor.js')`

### Renderer crashes on Record button
- Likely ScriptProcessorNode being used instead of AudioWorkletNode
- AudioWorklet must be used (ScriptProcessorNode is deprecated, causes segfaults)

### VAD not detecting speech
- Open DevTools console to see VAD state logs
- Check energy levels: `[AudioWorklet VAD] Speech detected! Energy: 0.0234`
- If energy too low, reduce `speechThreshold` or use calibration
- Ensure microphone permissions granted

### Duplicate transcriptions appearing
- Deduplication logic in `appendTranscription()` should handle this
- Check console logs for: `[Renderer] Detected overlap of N words`
- If still duplicating, VAD chunk boundaries may be too close

## Performance Characteristics

- **Transcription Latency**: ~2-5 seconds per chunk (M1/M2 Mac)
- **VAD Detection Latency**: 8-16ms (1-2 audio frames)
- **CPU During Recording**: <5% (VAD calculation: ~1-2%)
- **CPU During Transcription**: 30-50% (whisper.cpp)
- **Memory**: ~200MB app + ~500MB model loaded in whisper.cpp process
- **Temp Files**: ~15MB per minute of audio (WAV files cleaned up after transcription)

## Platform Notes

**macOS Only** (currently):
- Whisper.cpp compiled for Apple Silicon/Intel
- Setup script uses `cmake -B build && cmake --build build`
- To support Windows/Linux: Modify `setup-whisper.sh` for platform-specific compilation

## Extending This Codebase

### Adding New VAD Parameters
1. Update `VADConfig` interface in `src/shared/types.ts`
2. Update `DEFAULT_VAD_CONFIG` constant
3. Update worklet config in `audio-worklet-processor.js` constructor
4. Use `audioCaptureService.updateVADConfig()` to change at runtime

### Swapping Whisper.cpp for Cloud API
1. Create new class implementing same interface as `WhisperRunner`
2. Replace initialization in `src/main/ipc/transcription.ts`
3. Keep same `transcribe(audioFilePath)` method signature
4. Update to send audio directly instead of writing WAV file

### Adding UI for VAD Settings
- Extend `src/renderer/index.html` with settings panel
- Add sliders for thresholds, durations
- Call `audioCaptureService.updateVADConfig(newConfig)` on change
- Consider localStorage for persistence

### Supporting Other Languages
- Download different Whisper model (e.g., `ggml-medium.bin` for multilingual)
- Pass `-l <language>` flag to whisper-cpp in `whisper-runner.ts`
- Update model path in WhisperRunner constructor
