import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as readline from 'readline';
import { MonitorUpdate, MonitorConfig, DEFAULT_MONITOR_CONFIG } from '../../shared/types';

export class MonitorBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private config: MonitorConfig;
  private electronPID: number;
  private restartAttempts = 0;
  private maxRestartAttempts = 5;
  private restartBackoffMs = 1000;
  private isRunning = false;

  constructor(config: Partial<MonitorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_MONITOR_CONFIG, ...config };
    this.electronPID = process.pid;
  }

  private getBinaryPath(): string {
    // In development, use the build output
    // In production, this would be in the app resources
    return path.join(__dirname, '../ax-text-finder');
  }

  start(): void {
    if (this.isRunning) {
      console.log('[MonitorBridge] Already running');
      return;
    }

    this.isRunning = true;
    this.spawnProcess();
  }

  stop(): void {
    this.isRunning = false;
    this.restartAttempts = 0;

    if (this.process) {
      console.log('[MonitorBridge] Stopping monitor process');
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  private spawnProcess(): void {
    const binaryPath = this.getBinaryPath();

    const args = [
      '--refresh-interval', String(this.config.refreshInterval),
      '--electron-pid', String(this.electronPID),
      '--max-depth', String(this.config.maxDepth),
    ];

    if (this.config.debugMode) {
      args.push('--debug');
    }

    console.log(`[MonitorBridge] Spawning: ${binaryPath} ${args.join(' ')}`);

    try {
      this.process = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Handle stdout (JSON stream)
      if (this.process.stdout) {
        const rl = readline.createInterface({
          input: this.process.stdout,
          crlfDelay: Infinity,
        });

        rl.on('line', (line) => {
          this.handleOutputLine(line);
        });
      }

      // Handle stderr (debug/error messages)
      if (this.process.stderr) {
        this.process.stderr.on('data', (data) => {
          const message = data.toString().trim();
          if (message) {
            console.log(`[MonitorBridge:stderr] ${message}`);
          }
        });
      }

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`[MonitorBridge] Process exited with code ${code}, signal ${signal}`);
        this.process = null;

        if (this.isRunning) {
          this.handleCrash();
        }
      });

      // Handle spawn error
      this.process.on('error', (error) => {
        console.error('[MonitorBridge] Process error:', error);
        this.emit('error', { message: `Failed to spawn monitor: ${error.message}` });
      });

      // Reset restart attempts on successful start
      this.restartAttempts = 0;
      this.emit('started');
    } catch (error) {
      console.error('[MonitorBridge] Failed to spawn process:', error);
      this.emit('error', { message: `Failed to spawn monitor: ${(error as Error).message}` });
    }
  }

  private handleOutputLine(line: string): void {
    if (!line.trim()) return;

    try {
      const update = JSON.parse(line) as MonitorUpdate;

      // Debug: Log text box count
      if (this.config.debugMode) {
        console.log(`[MonitorBridge] Received update: ${update.appName}, ${update.textBoxes.length} text boxes`);
      }

      // Check for permission error
      if (update.error && update.error.includes('permission')) {
        this.emit('permission_denied', update.error);
        this.stop();
        return;
      }

      this.emit('update', update);
    } catch (error) {
      console.error('[MonitorBridge] Failed to parse JSON:', line, error);
    }
  }

  private handleCrash(): void {
    if (this.restartAttempts >= this.maxRestartAttempts) {
      console.error('[MonitorBridge] Max restart attempts reached, giving up');
      this.isRunning = false;
      this.emit('error', { message: 'Monitor crashed repeatedly, stopped trying to restart' });
      return;
    }

    this.restartAttempts++;
    const backoff = this.restartBackoffMs * Math.pow(2, this.restartAttempts - 1);

    console.log(`[MonitorBridge] Restarting in ${backoff}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})`);

    setTimeout(() => {
      if (this.isRunning) {
        this.spawnProcess();
      }
    }, backoff);
  }
}
