import { afterEach, expect, it, vi } from "vitest";
import { RelaySocket } from "./socket";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: () => void;
  send = vi.fn();
  constructor(public url: URL) { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  reply(body: string, binary = false) {
    const request = JSON.parse(this.send.mock.calls.at(-1)![0]);
    this.onmessage?.({ data: JSON.stringify({ id: request.id, status: 200, body, binary }) });
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); Socket.instances = []; });

it("reuses a connection for relay calls and decodes binary frames", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const relay = new RelaySocket("/chess/remote/", "123456", "host-token");
  const first = relay.request("api/state");
  const socket = Socket.instances[0]; socket.open(); await Promise.resolve();
  socket.reply('{"rev":1}');
  expect(await (await first).json()).toEqual({ rev: 1 });
  const second = relay.request("api/frame/A.jpg"); await Promise.resolve();
  socket.reply(btoa("jpeg"), true);
  expect(await (await second).text()).toBe("jpeg");
  expect(Socket.instances).toHaveLength(1);
  expect(socket.url.searchParams.get("code")).toBe("123456");
  expect(socket.url.searchParams.has("token")).toBe(false);
  relay.close();
});

it("rejects in-flight calls and backs off after disconnecting", async () => {
  vi.stubGlobal("WebSocket", Socket);
  const relay = new RelaySocket("/chess/remote/", "123456");
  const first = relay.request("api/state");
  Socket.instances[0].open(); await Promise.resolve();
  const rejected = expect(first).rejects.toThrow("disconnected");
  Socket.instances[0].close(); await rejected;
  await expect(relay.request("api/state")).rejects.toThrow("backoff");
  expect(Socket.instances).toHaveLength(1);
});
