import type { Alert } from '@fiber-pay/runtime';
import WebSocket from 'ws';

export type WsConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

type AlertListener = (alert: Alert) => void;
type StateListener = (state: WsConnectionState) => void;

export class WsAlertClient {
  private readonly url: string;
  private readonly maxBackoffMs: number;
  private ws: WebSocket | undefined;
  private backoffMs = 1000;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private shouldReconnect = false;
  private state: WsConnectionState = 'disconnected';
  private readonly alertListeners = new Set<AlertListener>();
  private readonly stateListeners = new Set<StateListener>();

  constructor(url: string, maxBackoffMs = 30000) {
    this.url = url;
    this.maxBackoffMs = maxBackoffMs;
  }

  start(): void {
    if (this.shouldReconnect) {
      return;
    }

    this.shouldReconnect = true;
    this.connect();
  }

  stop(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = undefined;
    }
    this.setState('disconnected');
  }

  onAlert(listener: AlertListener): () => void {
    this.alertListeners.add(listener);
    return () => {
      this.alertListeners.delete(listener);
    };
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private connect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    this.setState(this.state === 'disconnected' ? 'connecting' : 'reconnecting');

    const socket = new WebSocket(this.url);
    this.ws = socket;

    socket.on('open', () => {
      this.backoffMs = 1000;
      this.setState('connected');
    });

    socket.on('message', (data) => {
      if (typeof data !== 'string' && !(data instanceof Buffer)) {
        return;
      }

      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const alert = JSON.parse(text) as Alert;
        for (const listener of this.alertListeners) {
          listener(alert);
        }
      } catch {
        // ignore malformed frames
      }
    });

    socket.on('close', () => {
      this.ws = undefined;
      if (!this.shouldReconnect) {
        this.setState('disconnected');
        return;
      }
      this.scheduleReconnect();
    });

    socket.on('error', () => {
      if (this.ws === socket) {
        this.ws = undefined;
      }
      if (!this.shouldReconnect) {
        this.setState('disconnected');
        return;
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.setState('reconnecting');
    const waitMs = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, waitMs);
  }

  private setState(state: WsConnectionState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}
