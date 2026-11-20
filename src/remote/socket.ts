/** Multiplex relay requests over one connection instead of invoking a Worker per poll. */
export class RelaySocket {
  private socket?: WebSocket;
  private connecting?: Promise<WebSocket>;
  private next = 0;
  private retryAt = 0;
  private pending = new Map<number, { resolve(r: Response): void; reject(e: Error): void }>();
  constructor(private base: string, private code: string, private token = "") {}

  close() { this.socket?.close(); this.fail(); }
  private fail() {
    this.socket = undefined; this.connecting = undefined; this.retryAt = Date.now() + 15_000;
    for (const p of this.pending.values()) p.reject(new Error("Relay disconnected"));
    this.pending.clear();
  }
  private connect(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    if (Date.now() < this.retryAt) return Promise.reject(new Error("Relay reconnect backoff"));
    this.connecting = new Promise((resolve, reject) => {
      const url = new URL(`${this.base}socket`, location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("code", this.code);
      const ws = new WebSocket(url);
      const timeout = setTimeout(() => ws.close(), 10_000);
      ws.onopen = () => { clearTimeout(timeout); this.socket = ws; resolve(ws); };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error("Relay connection failed")); this.fail(); };
      ws.onclose = () => { clearTimeout(timeout); reject(new Error("Relay closed")); this.fail(); };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const p = this.pending.get(msg.id); if (!p) return;
        this.pending.delete(msg.id);
        const body = msg.binary ? Uint8Array.from(atob(msg.body), (c) => c.charCodeAt(0)) : msg.body;
        p.resolve(new Response(body, { status: msg.status, headers: msg.headers }));
      };
    });
    return this.connecting;
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const ws = await this.connect();
    const id = ++this.next;
    let body = init.body;
    if (body instanceof Blob) {
      const bytes = new Uint8Array(await body.arrayBuffer());
      let encoded = "";
      for (let i = 0; i < bytes.length; i += 8192) encoded += String.fromCharCode(...bytes.subarray(i, i + 8192));
      body = btoa(encoded);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error("Relay timed out")); this.close(); }, 10_000);
      this.pending.set(id, { resolve: (r) => { clearTimeout(timeout); resolve(r); }, reject: (e) => { clearTimeout(timeout); reject(e); } });
      try { ws.send(JSON.stringify({ id, path, method: init.method ?? "GET", body, binary: init.body instanceof Blob, token: this.token })); }
      catch { this.close(); }
    });
  }
}
