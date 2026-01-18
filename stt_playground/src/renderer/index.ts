import './styles/main.css';
import { AudioCaptureService, VADStateUpdate } from './services/audio-capture';

// DOM elements
const recordButton = document.getElementById('record-button') as HTMLButtonElement;
const clearButton = document.getElementById('clear-button') as HTMLButtonElement;
const copyButton = document.getElementById('copy-button') as HTMLButtonElement;
const transcriptionBox = document.getElementById('transcription-box') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const statusBar = statusText.parentElement as HTMLDivElement;

// Application state
let isRecording = false;
let transcriptionText = '';
let initialized = false;

// Audio capture service
const audioCaptureService = new AudioCaptureService();

// Global error handlers
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  updateStatus(`Error: ${event.error?.message || 'Unknown error'}`, 'error');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  updateStatus(`Error: ${event.reason?.message || 'Promise rejection'}`, 'error');
});

// Initialize the application
function init() {
  if (initialized) {
    console.log('[Renderer] Already initialized, skipping');
    return;
  }

  console.log('[Renderer] Voice-to-Text POC initializing...');

  // Check if electron API is available
  if (!window.electronAPI) {
    console.error('[Renderer] Electron API not available');
    updateStatus('Error: Electron API not available', 'error');
    return;
  }

  // Set up event listeners (only once)
  recordButton.addEventListener('click', toggleRecording);
  clearButton.addEventListener('click', clearTranscription);
  copyButton.addEventListener('click', copyTranscription);

  // Set up IPC listeners
  setupIPCListeners();

  initialized = true;
  updateStatus('Ready', 'ready');
  console.log('[Renderer] Initialization complete');
}

function setupIPCListeners() {
  // Listen for transcription results
  window.electronAPI.onTranscriptionResult((result) => {
    console.log('Transcription result received:', result);
    appendTranscription(result.text);
  });

  // Listen for transcription errors
  window.electronAPI.onTranscriptionError((error) => {
    console.error('Transcription error:', error);
    updateStatus(`Error: ${error.error}`, 'error');
  });

  // Listen for status updates
  window.electronAPI.onTranscriptionStatus((status) => {
    console.log('Status update:', status);
    updateStatus(status.message || status.status, status.status);
  });
}

function toggleRecording() {
  console.log('[Renderer] toggleRecording() called, isRecording:', isRecording);

  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  console.log('[Renderer] startRecording() called');

  if (isRecording) {
    console.log('[Renderer] Already recording, ignoring duplicate call');
    return;
  }

  try {
    isRecording = true;
    recordButton.classList.add('recording');
    recordButton.querySelector('.record-text')!.textContent = 'Stop';
    recordButton.disabled = true; // Prevent double-clicks

    console.log('[Renderer] Notifying main process...');
    // Notify main process
    try {
      window.electronAPI.startRecording();
      console.log('[Renderer] Main process notified');
    } catch (err) {
      console.error('[Renderer] Error notifying main process:', err);
      throw err;
    }

    console.log('[Renderer] Starting audio capture service with VAD...');
    // Start audio capture
    try {
      await audioCaptureService.start(
        (chunk, sampleRate, timestamp, vadMetadata) => {
          try {
            const chunkId = `${timestamp}-${chunk.length}`;
            console.log(`[Renderer] Speech chunk ready [ID: ${chunkId}]: ${chunk.length} samples`);
            if (vadMetadata) {
              console.log(`[Renderer] VAD metadata:`, vadMetadata);
            }

            // Convert Float32Array to regular array for IPC transfer
            const bufferArray = Array.from(chunk);
            console.log(`[Renderer] Converted to array [ID: ${chunkId}]: ${bufferArray.length} samples`);

            // Send audio chunk to main process
            console.log(`[Renderer] Sending to main process via IPC [ID: ${chunkId}]...`);
            window.electronAPI.processAudioChunk({
              buffer: bufferArray,
              sampleRate,
              timestamp,
            });
            console.log(`[Renderer] Chunk sent successfully [ID: ${chunkId}]`);
          } catch (chunkError) {
            console.error('[Renderer] Error processing chunk:', chunkError);
          }
        },
        (vadState: VADStateUpdate) => {
          // Handle VAD state updates for UI feedback
          console.log(`[Renderer] VAD state: ${vadState.state}, energy: ${vadState.energy.toFixed(4)}`);

          // Update status based on VAD state
          if (vadState.state === 'SPEAKING') {
            updateStatus('Speaking...', 'recording');
          } else if (vadState.state === 'LISTENING') {
            updateStatus('Listening...', 'recording');
          }
        }
      );
      console.log('[Renderer] Audio capture started with VAD');
    } catch (audioError) {
      console.error('[Renderer] Error starting audio capture:', audioError);
      throw audioError;
    }

    recordButton.disabled = false;
    updateStatus('Recording...', 'recording');
    console.log('[Renderer] Recording started successfully');
  } catch (error) {
    console.error('[Renderer] Failed to start recording:', error);
    console.error('[Renderer] Error stack:', (error as Error).stack);
    alert(`Failed to start recording: ${(error as Error).message}`);
    updateStatus(`Error: ${(error as Error).message}`, 'error');
    isRecording = false;
    recordButton.classList.remove('recording');
    recordButton.querySelector('.record-text')!.textContent = 'Record';
    recordButton.disabled = false;
  }
}

function stopRecording() {
  isRecording = false;
  recordButton.classList.remove('recording');
  recordButton.querySelector('.record-text')!.textContent = 'Record';

  // Stop audio capture
  audioCaptureService.stop();

  // Notify main process
  window.electronAPI.stopRecording();

  updateStatus('Ready', 'ready');
  console.log('Recording stopped');
}

function appendTranscription(text: string) {
  if (!text || text.trim().length === 0) {
    return;
  }

  const newText = text.trim();

  // Deduplication: Check if this text is similar to the end of existing text
  if (transcriptionText.length > 0) {
    // Get the last N words from existing text (where N is number of words in new text)
    const newWords = newText.split(/\s+/);
    const existingWords = transcriptionText.split(/\s+/);

    // Check for overlap (compare last few words of existing text with new text)
    const overlapCheckLength = Math.min(newWords.length, 10); // Check last 10 words max

    let maxOverlap = 0;
    for (let i = 1; i <= overlapCheckLength; i++) {
      const existingEnd = existingWords.slice(-i).join(' ').toLowerCase();
      const newStart = newWords.slice(0, i).join(' ').toLowerCase();

      if (existingEnd === newStart) {
        maxOverlap = i;
      }
    }

    // If we found significant overlap, skip those words from the new text
    if (maxOverlap > 0) {
      console.log(`[Renderer] Detected overlap of ${maxOverlap} words, deduplicating...`);
      const deduplicatedWords = newWords.slice(maxOverlap);

      if (deduplicatedWords.length === 0) {
        console.log('[Renderer] New text is complete duplicate, skipping');
        return; // Complete duplicate, skip
      }

      const deduplicatedText = deduplicatedWords.join(' ');
      transcriptionText += ' ' + deduplicatedText;
    } else {
      // No overlap, just add with space
      transcriptionText += ' ' + newText;
    }
  } else {
    // First transcription
    transcriptionText = newText;
  }

  // Update display
  transcriptionBox.textContent = transcriptionText;

  // Auto-scroll to bottom
  transcriptionBox.scrollTop = transcriptionBox.scrollHeight;

  // Add highlight animation to new text
  transcriptionBox.classList.add('new-text');
  setTimeout(() => {
    transcriptionBox.classList.remove('new-text');
  }, 500);
}

function clearTranscription() {
  transcriptionText = '';
  transcriptionBox.textContent = '';
  console.log('Transcription cleared');
}

function copyTranscription() {
  if (transcriptionText) {
    navigator.clipboard
      .writeText(transcriptionText)
      .then(() => {
        console.log('Transcription copied to clipboard');
        updateStatus('Copied to clipboard!', 'ready');
        setTimeout(() => {
          if (!isRecording) {
            updateStatus('Ready', 'ready');
          } else {
            updateStatus('Recording...', 'recording');
          }
        }, 2000);
      })
      .catch((err) => {
        console.error('Failed to copy:', err);
        updateStatus('Failed to copy', 'error');
      });
  } else {
    console.log('Nothing to copy');
  }
}

function updateStatus(message: string, type: 'idle' | 'ready' | 'recording' | 'processing' | 'error') {
  statusText.textContent = message;
  statusBar.className = 'status-bar';

  // Map status types to CSS classes
  if (type === 'recording') {
    statusBar.classList.add('recording');
  } else if (type === 'processing') {
    statusBar.classList.add('processing');
  } else if (type === 'error') {
    statusBar.classList.add('error');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
