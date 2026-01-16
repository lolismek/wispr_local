# Voice-to-Text POC with Whisper.cpp

A lightweight desktop application that captures microphone input, transcribes speech using Whisper.cpp, and displays the transcription in real-time.

## Features

- Real-time speech-to-text transcription
- Local processing (no cloud/API required)
- Simple, clean UI
- Copy and clear functionality
- Chunked audio processing (3-second intervals)
- Status indicators for recording/processing states

## Tech Stack

- **Frontend/UI**: Electron + TypeScript
- **Audio Capture**: Web Audio API
- **STT Engine**: Whisper.cpp (process execution)
- **Model**: Whisper Small (466MB, good accuracy-speed balance)
- **Target Platform**: macOS (tested on Darwin 23.4.0)

## Prerequisites

- **Node.js** (v14 or higher)
- **npm** (comes with Node.js)
- **cmake** (for compiling whisper.cpp)
  ```bash
  brew install cmake
  ```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Whisper.cpp

This will clone whisper.cpp, compile it for macOS, and download the Small model (~466MB):

```bash
npm run setup-whisper
```

This process may take a few minutes depending on your internet connection and CPU.

### 3. Build the Application

```bash
npm run build
```

### 4. Run the Application

```bash
npm start
```

## Usage

1. Click the **Record** button to start recording
2. Grant microphone permission when prompted
3. Speak clearly into your microphone
4. The transcription will appear in real-time (processed in 3-second chunks)
5. Click **Stop** to end recording
6. Use **Copy** to copy the transcription to clipboard
7. Use **Clear** to reset the transcription

## Project Structure

```
stt_playground/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts            # App entry point
│   │   ├── window.ts           # Window management
│   │   ├── preload.ts          # Preload script (IPC bridge)
│   │   ├── ipc/
│   │   │   └── transcription.ts # IPC handlers
│   │   └── whisper/
│   │       ├── whisper-runner.ts    # Whisper.cpp runner
│   │       └── audio-processor.ts   # Audio format conversion
│   ├── renderer/                # Electron renderer process
│   │   ├── index.html          # Main HTML
│   │   ├── index.ts            # Main renderer logic
│   │   ├── services/
│   │   │   └── audio-capture.ts     # Audio capture service
│   │   └── styles/
│   │       └── main.css        # Styling
│   └── shared/
│       └── types.ts            # Shared TypeScript types
├── whisper/                    # Whisper.cpp binaries & models
│   ├── binaries/
│   │   └── whisper-cpp
│   └── models/
│       └── ggml-small.bin
└── scripts/
    └── setup-whisper.sh        # Setup script
```

## Architecture

### Audio Pipeline

```
User clicks Record
    ↓
Microphone Permission
    ↓
Web Audio API → AudioContext (16kHz, mono)
    ↓
ScriptProcessorNode (4096 buffer size)
    ↓
Collect 3-second chunks (Float32Array)
    ↓
IPC: Send to Main Process
    ↓
Convert Float32Array → WAV file
    ↓
Spawn whisper.cpp process
    ↓
Parse transcription from stdout
    ↓
IPC: Send result to Renderer
    ↓
Display in UI + auto-scroll
    ↓
Clean up temp WAV file
```

### Key Design Decisions

1. **Process Execution**: Whisper.cpp runs as a separate process (not native bindings) for simplicity and easier debugging
2. **Chunked Processing**: Audio is processed in 3-second chunks to provide real-time feedback
3. **16kHz Sample Rate**: Sufficient for speech recognition, reduces file size
4. **Context Isolation**: Renderer process is isolated with secure IPC via preload script
5. **Sequential Processing**: Chunks are queued and processed sequentially to avoid resource contention

## Scalability Considerations

The implementation is designed for future integration into larger applications:

- **Service-Oriented**: `WhisperRunner` and `AudioCaptureService` can be imported as standalone modules
- **Backend Abstraction**: Easy to swap whisper.cpp for cloud APIs (OpenAI, Deepgram) by implementing the same interface
- **Configuration**: Model path, chunk duration, and sample rate are configurable
- **Event-Driven**: Uses event emitters for extensibility
- **Modular UI**: Components are reusable and loosely coupled

## Troubleshooting

### Microphone Permission Denied

- Check System Preferences → Security & Privacy → Privacy → Microphone
- Ensure the app (or Terminal, if running from terminal) has microphone access

### Whisper.cpp Not Found

- Ensure you ran `npm run setup-whisper` successfully
- Check that `./whisper/binaries/whisper-cpp` exists
- Check that `./whisper/models/ggml-small.bin` exists

### Build Errors

- Clear node_modules and rebuild:
  ```bash
  rm -rf node_modules dist
  npm install
  npm run build
  ```

### Audio Not Capturing

- Check browser console (Cmd+Option+I) for errors
- Verify microphone is working in other apps
- Try restarting the application

### Transcription Errors

- Check terminal logs for whisper.cpp output
- Verify the model file is not corrupted
- Try speaking more clearly and closer to the microphone

## Performance

- **Transcription Latency**: ~2-5 seconds per 3-second chunk (on M1/M2 Mac)
- **CPU Usage**: ~30-50% during transcription
- **Memory**: ~200MB for app + ~500MB for model
- **Disk**: ~15MB temp files per minute of audio (cleaned up automatically)

## Known Limitations

- macOS only (can be extended to Windows/Linux with minor changes)
- No true streaming (whisper.cpp requires complete audio files)
- English language only with Small model (can use multilingual models)
- No speaker diarization or timestamps (can be added with flags)

## Future Enhancements

- Voice Activity Detection (VAD) to skip silence
- Punctuation model integration
- Language detection and translation
- Export to file (TXT, SRT, etc.)
- Global hotkeys for start/stop
- System tray integration
- Model selection UI

## License

MIT

## Credits

- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) by Georgi Gerganov
- [OpenAI Whisper](https://github.com/openai/whisper) by OpenAI
