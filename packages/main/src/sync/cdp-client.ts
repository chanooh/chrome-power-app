import WebSocket, {type RawData} from 'ws';

export interface CdpEvent<T = Record<string, unknown>> {
  method: string;
  params: T;
  sessionId?: string;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

type EventListener = (event: CdpEvent) => void;

export class CdpClient {
  private socket?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private listeners = new Map<string, Set<EventListener>>();
  private closed = false;

  constructor(
    readonly endpoint: string,
    private readonly defaultTimeoutMs = 2_000,
  ) {}

  async connect(timeoutMs = 5_000): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    this.closed = false;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.endpoint, {perMessageDeflate: false});
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`CDP connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.once('open', () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on('message', data => this.handleMessage(data));
        socket.on('close', () => this.handleClose(new Error('CDP connection closed')));
        socket.on('error', error => this.handleClose(error));
        resolve();
      });
      socket.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.closed) {
      return Promise.reject(new Error('CDP client is not connected'));
    }

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timer,
      });
      this.socket!.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }

  on(method: string, listener: EventListener): () => void {
    const listeners = this.listeners.get(method) || new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(method);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket?.close();
    this.handleClose(new Error('CDP client disconnected'));
  }

  private handleMessage(raw: RawData): void {
    let message: {
      id?: number;
      result?: unknown;
      error?: {message?: string; data?: string};
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    };
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(message.error.data || message.error.message || 'Unknown CDP error'),
        );
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }

    if (!message.method) return;
    const event: CdpEvent = {
      method: message.method,
      params: message.params || {},
      sessionId: message.sessionId,
    };
    for (const listener of this.listeners.get(message.method) || []) listener(event);
    for (const listener of this.listeners.get('*') || []) listener(event);
  }

  private handleClose(error: Error): void {
    if (this.closed && this.pending.size === 0) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    const event: CdpEvent = {
      method: 'ChromePower.connectionClosed',
      params: {message: error.message},
    };
    for (const listener of this.listeners.get('ChromePower.connectionClosed') || [])
      listener(event);
  }
}
