/** Sends the DMX universe to `bridge/dmx-bridge.mjs` (browser -> WebSocket -> Art-Net/sACN node). */
export class DmxSink {
  private ws: WebSocket | null = null;
  private last = "";
  connected = false;
  constructor(public url = "ws://127.0.0.1:8787") {}

  connect() {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => (this.connected = true);
      this.ws.onclose = () => { this.connected = false; this.ws = null; };
      this.ws.onerror = () => this.ws?.close();
    } catch { /* offline */ }
  }

  send(universe: number, channels: number[]) {
    // only send on change, trimmed to the last non-zero channel
    let n = channels.length;
    while (n > 0 && channels[n - 1] === 0) n--;
    const frame = JSON.stringify({ universe, channels: channels.slice(0, Math.max(n, 8)) });
    if (frame === this.last) return;
    this.last = frame;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
  }
}
