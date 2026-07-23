export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

type LogListener = (logs: LogEntry[]) => void;

class LoggerService {
  private logs: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();

  private log(level: 'info' | 'warn' | 'error', message: string) {
    const timestamp = new Date().toLocaleTimeString();
    const entry: LogEntry = { timestamp, level, message };

    // Console log as well so standard debuggers see it
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);

    this.logs.push(entry);

    // Keep last 300 logs to prevent memory overflow
    if (this.logs.length > 300) {
      this.logs.shift();
    }

    this.notify();
  }

  info(message: string) {
    this.log('info', message);
  }

  warn(message: string) {
    this.log('warn', message);
  }

  error(message: string) {
    this.log('error', message);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.notify();
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    // Initial call
    listener(this.getLogs());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const currentLogs = this.getLogs();
    this.listeners.forEach((listener) => {
      try {
        listener(currentLogs);
      } catch (e) {
        console.warn('Listener notification failed', e);
      }
    });
  }
}

export const logger = new LoggerService();
