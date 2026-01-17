/// <reference path="./types.d.ts" />
import './styles/main.css';
import { MonitorUpdate, MonitorStatusUpdate, TextBoxInfo } from '../shared/types';

// DOM elements
const statusIndicator = document.getElementById('status-indicator') as HTMLSpanElement;
const permissionStatus = document.getElementById('permission-status') as HTMLSpanElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const stopButton = document.getElementById('stop-button') as HTMLButtonElement;
const permissionButton = document.getElementById('permission-button') as HTMLButtonElement;
const currentAppDiv = document.getElementById('current-app') as HTMLDivElement;
const lastUpdateDiv = document.getElementById('last-update') as HTMLDivElement;
const textBoxCountSpan = document.getElementById('text-box-count') as HTMLSpanElement;
const textBoxesList = document.getElementById('text-boxes-list') as HTMLDivElement;

// Application state
let isMonitoring = false;
let hasPermission = false;
let initialized = false;

// Initialize the application
async function init() {
  if (initialized) {
    console.log('[Renderer] Already initialized, skipping');
    return;
  }

  console.log('[Renderer] Text Box Monitor initializing...');

  if (!window.electronAPI) {
    console.error('[Renderer] Electron API not available');
    updatePermissionStatus('Error: API not available', 'denied');
    return;
  }

  // Set up event listeners
  startButton.addEventListener('click', startMonitoring);
  stopButton.addEventListener('click', stopMonitoring);
  permissionButton.addEventListener('click', requestPermission);

  // Set up IPC listeners
  setupIPCListeners();

  // Check initial permission status
  await checkPermission();

  initialized = true;
  console.log('[Renderer] Initialization complete');
}

function setupIPCListeners() {
  // Listen for text box updates
  window.electronAPI.onTextBoxesUpdate((update: MonitorUpdate) => {
    console.log('[Renderer] Text boxes update received:', update.textBoxes.length, 'boxes');
    handleUpdate(update);
  });

  // Listen for status updates
  window.electronAPI.onMonitorStatus((status: MonitorStatusUpdate) => {
    console.log('[Renderer] Status update:', status);
    handleStatusUpdate(status);
  });
}

async function checkPermission() {
  updatePermissionStatus('Checking...', 'checking');

  try {
    const result = await window.electronAPI.checkAccessibilityPermission();

    if (!result.binaryExists) {
      updatePermissionStatus('Binary not found', 'denied');
      showPermissionButton(false);
      startButton.disabled = true;
      return;
    }

    hasPermission = result.hasPermission;

    if (hasPermission) {
      updatePermissionStatus('Granted', 'granted');
      showPermissionButton(false);
      startButton.disabled = false;
    } else {
      updatePermissionStatus('Not granted', 'denied');
      showPermissionButton(true);
      startButton.disabled = true;
    }
  } catch (error) {
    console.error('[Renderer] Permission check failed:', error);
    updatePermissionStatus('Check failed', 'denied');
  }
}

async function requestPermission() {
  try {
    await window.electronAPI.requestAccessibilityPermission();
    updatePermissionStatus('Grant to Terminal.app or your IDE...', 'checking');
    currentAppDiv.textContent = 'Add Terminal.app (or your IDE/terminal) to the Accessibility list';

    // Poll for permission change
    const pollInterval = setInterval(async () => {
      const result = await window.electronAPI.checkAccessibilityPermission();
      if (result.hasPermission) {
        clearInterval(pollInterval);
        hasPermission = true;
        updatePermissionStatus('Granted', 'granted');
        showPermissionButton(false);
        startButton.disabled = false;
        currentAppDiv.textContent = 'No active monitoring';
      }
    }, 2000);

    // Stop polling after 60 seconds
    setTimeout(() => clearInterval(pollInterval), 60000);
  } catch (error) {
    console.error('[Renderer] Permission request failed:', error);
  }
}

async function startMonitoring() {
  if (isMonitoring) return;

  console.log('[Renderer] Starting monitoring...');
  startButton.disabled = true;

  try {
    const result = await window.electronAPI.startMonitoring();

    if (result.success) {
      isMonitoring = true;
      stopButton.disabled = false;
    } else {
      console.error('[Renderer] Failed to start:', result.error);
      startButton.disabled = false;
    }
  } catch (error) {
    console.error('[Renderer] Start monitoring error:', error);
    startButton.disabled = false;
  }
}

async function stopMonitoring() {
  if (!isMonitoring) return;

  console.log('[Renderer] Stopping monitoring...');
  stopButton.disabled = true;

  try {
    await window.electronAPI.stopMonitoring();
    isMonitoring = false;
    startButton.disabled = false;
  } catch (error) {
    console.error('[Renderer] Stop monitoring error:', error);
    stopButton.disabled = false;
  }
}

function handleUpdate(update: MonitorUpdate) {
  // Update app info
  if (update.isPaused) {
    currentAppDiv.textContent = `Monitoring paused (own app active)`;
    updateStatusIndicator('paused', 'Paused');
  } else {
    currentAppDiv.textContent = `Monitoring: ${update.appName} (PID: ${update.appPID})`;
  }

  // Update timestamp
  const timestamp = new Date(update.timestamp);
  lastUpdateDiv.textContent = `Last Update: ${timestamp.toLocaleTimeString()}.${timestamp.getMilliseconds().toString().padStart(3, '0')}`;

  // Update text box count
  textBoxCountSpan.textContent = String(update.textBoxes.length);

  // Update text boxes list
  renderTextBoxes(update.textBoxes);

  // Handle errors
  if (update.error) {
    console.error('[Renderer] Update error:', update.error);
  }
}

function handleStatusUpdate(status: MonitorStatusUpdate) {
  switch (status.status) {
    case 'stopped':
      isMonitoring = false;
      updateStatusIndicator('stopped', 'Stopped');
      startButton.disabled = false;
      stopButton.disabled = true;
      currentAppDiv.textContent = 'No active monitoring';
      lastUpdateDiv.textContent = '';
      break;

    case 'starting':
      updateStatusIndicator('starting', 'Starting...');
      break;

    case 'running':
      isMonitoring = true;
      updateStatusIndicator('running', 'Running');
      startButton.disabled = true;
      stopButton.disabled = false;
      break;

    case 'error':
      updateStatusIndicator('error', status.message || 'Error');
      isMonitoring = false;
      startButton.disabled = false;
      stopButton.disabled = true;
      break;

    case 'permission_denied':
      updateStatusIndicator('permission_denied', 'Permission Denied');
      updatePermissionStatus('Not granted', 'denied');
      showPermissionButton(true);
      isMonitoring = false;
      startButton.disabled = true;
      stopButton.disabled = true;
      break;
  }
}

function updateStatusIndicator(status: string, text: string) {
  statusIndicator.className = `status-indicator ${status}`;
  statusIndicator.textContent = text;
}

function updatePermissionStatus(text: string, status: 'granted' | 'denied' | 'checking') {
  permissionStatus.textContent = text;
  permissionStatus.className = `permission-status ${status}`;
}

function showPermissionButton(show: boolean) {
  permissionButton.style.display = show ? 'block' : 'none';
}

function renderTextBoxes(textBoxes: TextBoxInfo[]) {
  if (textBoxes.length === 0) {
    textBoxesList.innerHTML = '<div class="empty-state">No text boxes found in this window</div>';
    return;
  }

  textBoxesList.innerHTML = textBoxes.map((box, index) => createTextBoxCard(box, index)).join('');
}

function createTextBoxCard(box: TextBoxInfo, index: number): string {
  const focusedClass = box.isFocused ? 'focused' : '';
  const focusedBadge = box.isFocused ? '<span class="text-box-focused">Focused</span>' : '';

  return `
    <div class="text-box-card ${focusedClass}">
      <div class="text-box-header">
        <span class="text-box-role">#${index + 1} ${box.role}</span>
        ${focusedBadge}
      </div>
      <div class="text-box-detail">
        <span class="detail-label">Position:</span>
        <span class="detail-value">x: ${Math.round(box.position.x)}, y: ${Math.round(box.position.y)}</span>
      </div>
      <div class="text-box-detail">
        <span class="detail-label">Size:</span>
        <span class="detail-value">${Math.round(box.size.width)} x ${Math.round(box.size.height)}</span>
      </div>
      ${box.label ? `
      <div class="text-box-detail">
        <span class="detail-label">Label:</span>
        <span class="detail-value">${escapeHtml(box.label)}</span>
      </div>` : ''}
      ${box.placeholder ? `
      <div class="text-box-detail">
        <span class="detail-label">Placeholder:</span>
        <span class="detail-value">${escapeHtml(box.placeholder)}</span>
      </div>` : ''}
      ${box.value ? `
      <div class="text-box-detail">
        <span class="detail-label">Value:</span>
        <span class="detail-value">${escapeHtml(truncate(box.value, 100))}</span>
      </div>` : ''}
      <div class="text-box-detail">
        <span class="detail-label">Enabled:</span>
        <span class="detail-value">${box.isEnabled ? 'Yes' : 'No'}</span>
      </div>
    </div>
  `;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
