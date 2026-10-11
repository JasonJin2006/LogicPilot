import { createHash } from 'node:crypto';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME_BYTES = 256 * 1024;

/** Attach the same-origin execution event subscription transport. Controls
 * remain HTTP; this channel only sends snapshots and sequenced events. */
export function attachExecutionWebSocket({
  server,
  path = '/api/execution/events',
  getService,
  sessionToken,
  allowedOrigin,
  allowedHost,
}) {
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    const host = req.headers.host;
    const key = req.headers['sec-websocket-key'];
    const token = url.searchParams.get('token');
    if (
      typeof key !== 'string' ||
      token !== sessionToken ||
      host !== allowedHost ||
      (origin !== undefined &&
        origin !== allowedOrigin &&
        origin !== 'tauri://localhost' &&
        origin !== 'http://tauri.localhost' &&
        origin !== 'https://tauri.localhost')
    ) {
      reject(socket, 401, 'execution websocket authorization failed');
      return;
    }
    const runId = url.searchParams.get('runId');
    const service = getService();
    if (service === null || runId === null) {
      reject(
        socket,
        service === null ? 503 : 400,
        service === null ? 'execution service is not configured' : 'runId is required',
      );
      return;
    }
    const afterSeq = Number(url.searchParams.get('afterSeq') ?? '-1');
    const subscription = service.subscribe(
      runId,
      Number.isFinite(afterSeq) ? afterSeq : -1,
      () => {},
    );
    if (subscription.initial === undefined) {
      reject(socket, 404, 'execution run was not found');
      return;
    }
    const accept = createHash('sha1')
      .update(key + MAGIC)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' +
        accept +
        '\r\n\r\n',
    );
    const send = (value) => {
      const body = Buffer.from(JSON.stringify(value), 'utf8');
      if (body.length > MAX_FRAME_BYTES || !writeTextFrame(socket, body)) socket.destroy();
    };
    send({
      schema: 'logicpilot.execution-event-stream/v1',
      contractVersion: 1,
      runId,
      session: subscription.initial.session,
      events: subscription.initial.events,
      nextSeq: subscription.initial.nextSeq,
      gap: subscription.initial.gap,
    });
    const liveSubscription = service.subscribe(runId, subscription.initial.nextSeq, send);
    const cleanup = () => {
      subscription.unsubscribe();
      liveSubscription.unsubscribe();
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
    socket.on('data', (chunk) => {
      // Commands remain on HTTP; only WebSocket control frames are handled.
      for (const frame of parseFrames(chunk)) {
        if (frame.opcode === 0x8) socket.end();
        else if (frame.opcode === 0x9)
          socket.write(Buffer.from([0x8a, frame.payload.length, ...frame.payload]));
      }
    });
  });
}

function reject(socket, status, message) {
  socket.end(
    'HTTP/1.1 ' +
      status +
      ' Error\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ' +
      Buffer.byteLength(message) +
      '\r\n\r\n' +
      message,
  );
}

function writeTextFrame(socket, body) {
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x81, body.length]);
  } else if (body.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    return false;
  }
  return socket.write(Buffer.concat([header, body]));
}

function parseFrames(chunk) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= chunk.length) {
    const first = chunk[offset];
    const second = chunk[offset + 1];
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (cursor + 2 > chunk.length) break;
      length = chunk.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127 || length > MAX_FRAME_BYTES) {
      break;
    }
    const masked = (second & 0x80) !== 0;
    const maskEnd = cursor + (masked ? 4 : 0);
    const end = maskEnd + length;
    if (end > chunk.length) break;
    const payload = Buffer.from(chunk.subarray(maskEnd, end));
    if (masked) {
      const mask = chunk.subarray(cursor, maskEnd);
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
    }
    frames.push({ opcode: first & 0x0f, payload });
    offset = end;
  }
  return frames;
}
