const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const WebSocket = require('ws');

const PORT      = process.env.PORT || 8080;
const CARDS_DIR = path.join(__dirname, 'cards');
const BOARD_FILE = path.join(__dirname, 'board.html');

// ── HTTP: serves board.html and card images ───────────────────────────────
const httpServer = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/' || pathname === '/board.html') {
    fs.readFile(BOARD_FILE, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.url.startsWith('/cards/')) {
    const filename = decodeURIComponent(req.url.slice(7));
    const filepath = path.join(CARDS_DIR, filename);
    // Prevent path traversal
    if (!filepath.startsWith(CARDS_DIR)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filepath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// ── WebSocket: relay server ───────────────────────────────────────────────
const wss = new WebSocket.Server({ server: httpServer });

let boardCounter = 0;
const clients     = new Map(); // ws → { boardId, type }
const boardStates = new Map(); // boardId → { slotIndex: cardName }

wss.on('connection', ws => {
  clients.set(ws, { boardId: null, type: null });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const client = clients.get(ws);

    switch (msg.type) {

      case 'join': {
        if (msg.mode === 'board') {
          const boardId = `Board ${++boardCounter}`;
          clients.set(ws, { boardId, type: 'board' });
          boardStates.set(boardId, {});
          send(ws, { type: 'assigned', boardId });
          log(`+ ${boardId}`);
        } else {
          clients.set(ws, { boardId: 'central', type: 'central' });
          const boards = {};
          boardStates.forEach((state, id) => { boards[id] = { ...state }; });
          send(ws, { type: 'full_state', boards });
          log('+ Central view');
        }
        break;
      }

      case 'place': {
        if (client?.type !== 'board') break;
        boardStates.get(client.boardId)[msg.slotIndex] = msg.cardName;
        broadcast({ type: 'place', boardId: client.boardId, slotIndex: msg.slotIndex, cardName: msg.cardName });
        break;
      }

      case 'remove': {
        if (client?.type !== 'board') break;
        delete boardStates.get(client.boardId)?.[msg.slotIndex];
        broadcast({ type: 'remove', boardId: client.boardId, slotIndex: msg.slotIndex });
        break;
      }
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client?.type === 'board') {
      broadcast({ type: 'board_disconnect', boardId: client.boardId });
      boardStates.delete(client.boardId);
      log(`- ${client.boardId}`);
    } else if (client?.type === 'central') {
      log('- Central view');
    }
    clients.delete(ws);
  });

  ws.on('error', () => ws.close());
});

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function log(msg) {
  const now = new Date().toTimeString().slice(0, 8);
  console.log(`[${now}] ${msg}  (${wss.clients.size} connected)`);
}

httpServer.listen(PORT, () => {
  console.log(`Value Board server  →  http://localhost:${PORT}`);
  console.log(`Board view:    http://localhost:${PORT}/`);
  console.log(`Central view:  http://localhost:${PORT}/?mode=central`);
  console.log(`Remote boards: http://<this-machine-ip>:${PORT}/`);
});
