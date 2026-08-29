/**
 * Minimal WebSocket server (no external deps) for share-screen realtime.
 * Supports text frames only (JSON messages).
 */
const crypto = require('crypto');
const hub = require('./shareScreenHub');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '', 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, data]);
}

function decodeFrames(buffer, onFrame) {
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let pos = offset + 2;
    if (len === 126) {
      if (pos + 2 > buffer.length) break;
      len = buffer.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (pos + 8 > buffer.length) break;
      const high = buffer.readUInt32BE(pos);
      const low = buffer.readUInt32BE(pos + 4);
      if (high !== 0) break; // too large
      len = low;
      pos += 8;
    }
    const maskLen = masked ? 4 : 0;
    if (pos + maskLen + len > buffer.length) break;
    let payload = buffer.slice(pos + maskLen, pos + maskLen + len);
    if (masked) {
      const mask = buffer.slice(pos, pos + 4);
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
      payload = out;
    }
    onFrame(opcode, payload);
    offset = pos + maskLen + len;
  }
  return buffer.slice(offset);
}

function wrapSocket(raw) {
  let buf = Buffer.alloc(0);
  const ws = {
    readyState: 1, // OPEN
    send(text) {
      if (ws.readyState !== 1) return;
      try { raw.write(encodeFrame(OP_TEXT, text)); } catch (_) {}
    },
    close() {
      if (ws.readyState !== 1) return;
      ws.readyState = 3;
      try { raw.write(encodeFrame(OP_CLOSE, Buffer.alloc(0))); } catch (_) {}
      try { raw.end(); } catch (_) {}
    },
    _screenId: null,
    _userId: null
  };

  raw.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    buf = decodeFrames(buf, (opcode, payload) => {
      if (opcode === OP_CLOSE) {
        ws.readyState = 3;
        try { raw.end(); } catch (_) {}
        return;
      }
      if (opcode === OP_PING) {
        try { raw.write(encodeFrame(OP_PONG, payload)); } catch (_) {}
        return;
      }
      if (opcode === OP_TEXT) {
        let msg;
        try { msg = JSON.parse(payload.toString('utf8')); } catch (_) { return; }
        handleMessage(ws, msg);
      }
    });
  });

  raw.on('close', () => {
    ws.readyState = 3;
    onDisconnect(ws);
  });
  raw.on('error', () => {
    ws.readyState = 3;
    onDisconnect(ws);
  });

  return ws;
}

function handleMessage(ws, msg) {
  if (!msg || !msg.type) return;
  const appConfig = ws._appConfig || {};

  if (msg.type === 'join') {
    const got = hub.getScreen(msg.screenId, appConfig);
    if (!got) {
      ws.send(JSON.stringify({ type: 'error', error: 'Share screen not found or expired' }));
      return;
    }
    const { screen, conf } = got;
    // leave previous
    if (ws._screenId && ws._screenId !== screen.id) {
      const prev = hub.shareScreens.get(ws._screenId);
      if (prev) {
        hub.detachSocket(prev, ws);
        if (ws._userId) prev.users.delete(ws._userId);
        hub.broadcast(prev, hub.snapshot(prev, hub.getConfig(appConfig)));
      }
    }
    ws._screenId = screen.id;
    ws._userId = msg.userId || null;
    hub.attachSocket(screen, ws);
    if (msg.userId) {
      hub.applyPresence(screen, {
        userId: msg.userId,
        lat: msg.lat,
        lon: msg.lon,
        name: msg.name,
        trail: msg.trail
      });
      // Optional: seed/upsert items on join (pre-drawn content or reconnect)
      if (Array.isArray(msg.items) && msg.items.length) {
        hub.upsertItems(screen, msg.userId, msg.items);
      }
    }
    ws.send(JSON.stringify(hub.snapshot(screen, conf)));
    hub.broadcast(screen, hub.snapshot(screen, conf), ws);
    return;
  }

  if (msg.type === 'presence') {
    if (!ws._screenId) return;
    const got = hub.getScreen(ws._screenId, appConfig);
    if (!got) {
      ws.send(JSON.stringify({ type: 'expired' }));
      return;
    }
    const { screen, conf } = got;
    // Presence only — content is synced via content-upsert / content-delete
    hub.applyPresence(screen, {
      userId: msg.userId || ws._userId,
      lat: msg.lat,
      lon: msg.lon,
      name: msg.name,
      trail: msg.trail
    });
    hub.broadcast(screen, hub.snapshot(screen, conf));
    return;
  }

  if (msg.type === 'content-upsert') {
    if (!ws._screenId) return;
    const got = hub.getScreen(ws._screenId, appConfig);
    if (!got) {
      ws.send(JSON.stringify({ type: 'expired' }));
      return;
    }
    const { screen, conf } = got;
    const userId = msg.userId || ws._userId;
    if (!userId) return;
    hub.upsertItems(screen, userId, msg.items || []);
    hub.broadcast(screen, hub.snapshot(screen, conf));
    return;
  }

  if (msg.type === 'content-delete') {
    if (!ws._screenId) return;
    const got = hub.getScreen(ws._screenId, appConfig);
    if (!got) {
      ws.send(JSON.stringify({ type: 'expired' }));
      return;
    }
    const { screen, conf } = got;
    const userId = msg.userId || ws._userId;
    if (!userId) return;
    hub.deleteItems(screen, userId, msg.itemIds || []);
    hub.broadcast(screen, hub.snapshot(screen, conf));
    return;
  }

  if (msg.type === 'leave') {
    onDisconnect(ws);
    return;
  }

  // WebRTC signaling + host AV control (relay only)
  if (msg.type === 'signal' || msg.type === 'force-mute' || msg.type === 'force-mute-all' || msg.type === 'av-state') {
    if (!ws._screenId) return;
    const screen = hub.shareScreens.get(ws._screenId);
    if (!screen) return;
    const fromId = msg.from || ws._userId;
    const payload = { ...msg, from: fromId };

    if (msg.type === 'force-mute' || msg.type === 'force-mute-all') {
      // Only owner may force-mute
      if (screen.ownerId && ws._userId && screen.ownerId !== ws._userId) {
        ws.send(JSON.stringify({ type: 'error', error: 'Only the share screen creator can mute others' }));
        return;
      }
    }

    if (msg.type === 'signal' && msg.to) {
      // Point-to-point: deliver only to target peer
      for (const sock of screen.sockets) {
        if (sock._userId === msg.to && sock.readyState === 1) {
          try { sock.send(JSON.stringify(payload)); } catch (_) {}
        }
      }
      return;
    }

    // Broadcast to everyone else in the screen
    hub.broadcast(screen, payload, ws);
    return;
  }
}

function onDisconnect(ws) {
  if (!ws._screenId) return;
  const screen = hub.shareScreens.get(ws._screenId);
  if (!screen) return;
  hub.detachSocket(screen, ws);
  // Presence only — content bucket is kept for the session lifetime
  if (ws._userId) {
    screen.users.delete(ws._userId);
  }
  hub.broadcast(screen, hub.snapshot(screen, hub.getConfig(ws._appConfig || {})));
  ws._screenId = null;
}

function attachWebSocketServer(httpServer, getAppConfig) {
  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      if (url.pathname !== '/ws/share-screen') {
        socket.destroy();
        return;
      }
      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }
      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + acceptKey(key),
        '',
        ''
      ].join('\r\n');
      socket.write(headers);
      if (head && head.length) socket.unshift(head);
      const ws = wrapSocket(socket);
      ws._appConfig = typeof getAppConfig === 'function' ? getAppConfig() : {};
    } catch (_) {
      try { socket.destroy(); } catch (__) {}
    }
  });
}

module.exports = { attachWebSocketServer };
