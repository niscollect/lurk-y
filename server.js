import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import handler from './api/fetch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.PERSISTENT_DIR 
  ? path.join(process.env.PERSISTENT_DIR, 'rooms.json') 
  : path.join(__dirname, 'rooms.json');

// Helper to load rooms from the JSON database
const loadRooms = () => {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data || '{}');
    }
  } catch (err) {
    console.error('Error loading rooms.json:', err.message);
  }
  return {};
};

// Helper to save rooms to the JSON database
const saveRooms = (rooms) => {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(rooms, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving rooms.json:', err.message);
  }
};

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const getRequestBody = (req) => {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        resolve({});
      }
    });
  });
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress;
};

const isAdminIp = (ip) => {
  const adminIpsStr = process.env.ADMIN_IP || '';
  if (!adminIpsStr) return false;
  const adminIps = adminIpsStr.split(',').map(s => s.trim());
  return adminIps.includes(ip);
};

const generateRoomCode = (existingRooms) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  while (true) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (!existingRooms[code]) {
      return code;
    }
  }
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Global CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // --- API: Platform sync proxy ---
  if (pathname === '/api/fetch') {
    // Add req.query helper
    const query = {};
    for (const [key, value] of parsedUrl.searchParams.entries()) {
      query[key] = value;
    }
    req.query = query;

    // Add res.status and res.json helpers
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return res;
    };

    try {
      await handler(req, res);
    } catch (err) {
      console.error('Error in fetch handler:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server proxy error', message: err.message }));
    }
    return;
  }

  // --- API: Get Client IP and Admin Status ---
  if (pathname === '/api/ip' && req.method === 'GET') {
    const ip = getClientIp(req);
    const isAdmin = isAdminIp(ip);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ip, isAdmin }));
    return;
  }

  // --- API: Get Room State ---
  if (pathname === '/api/room' && req.method === 'GET') {
    const roomId = parsedUrl.searchParams.get('id')?.toUpperCase();
    if (!roomId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing id parameter.' }));
      return;
    }

    const rooms = loadRooms();
    const room = rooms[roomId];

    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Room ${roomId} not found on server.` }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(room));
    return;
  }

  // --- API: Create Room ---
  if (pathname === '/api/room/create' && req.method === 'POST') {
    const body = await getRequestBody(req);
    const { room_name, member, admin_key } = body;

    if (!room_name || !member) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing room_name or member.' }));
      return;
    }

    const ip = getClientIp(req);
    const isAdmin = isAdminIp(ip);

    // If not on whitelisted IP, check for the secret admin passphrase
    if (!isAdmin) {
      const expectedKey = process.env.ADMIN_KEY || 'lurkadmin';
      if (admin_key !== expectedKey) {
        console.warn(`[UNAUTHORIZED ACCESS WARNING] Failed room creation attempt from IP: ${ip} for room: "${room_name}"`);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Your IP is not whitelisted, and the Admin Password is incorrect.' }));
        return;
      }
    }

    const rooms = loadRooms();
    const roomId = generateRoomCode(rooms);

    const newRoom = {
      room_id: roomId,
      room_name: room_name,
      created_at: Date.now(),
      last_weekly_reset: new Date().toLocaleDateString('sv'),
      members: [member],
      manual_logs: []
    };

    rooms[roomId] = newRoom;
    saveRooms(rooms);

    console.log(`[CREATE] Room "${room_name}" (Code: ${roomId}) created successfully by ${member.display_name} from IP: ${ip} (Total rooms: ${Object.keys(rooms).length})`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(newRoom));
    return;
  }

  // --- API: Join Room ---
  if (pathname === '/api/room/join' && req.method === 'POST') {
    const body = await getRequestBody(req);
    const { room_id, member } = body;

    if (!room_id || !member) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing room_id or member.' }));
      return;
    }

    const rooms = loadRooms();
    const room = rooms[room_id.toUpperCase()];

    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Room ${room_id} not found on server.` }));
      return;
    }

    // Check display name duplicate
    const dup = room.members.find(m => m.display_name.toLowerCase() === member.display_name.toLowerCase());
    if (dup) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Display name '${member.display_name}' is already taken in this room.` }));
      return;
    }

    room.members.push(member);
    rooms[room_id.toUpperCase()] = room;
    saveRooms(rooms);

    console.log(`[JOIN] Member "${member.display_name}" joined room: ${room_id.toUpperCase()} (Total members: ${room.members.length})`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(room));
    return;
  }

  // --- API: Add Member (Manual addition by existing member) ---
  if (pathname === '/api/room/add-member' && req.method === 'POST') {
    const body = await getRequestBody(req);
    const { room_id, member } = body;

    if (!room_id || !member) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing room_id or member.' }));
      return;
    }

    const rooms = loadRooms();
    const room = rooms[room_id.toUpperCase()];

    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Room ${room_id} not found.` }));
      return;
    }

    const dup = room.members.find(m => m.display_name.toLowerCase() === member.display_name.toLowerCase());
    if (dup) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Display name '${member.display_name}' is already in use.` }));
      return;
    }

    room.members.push(member);
    rooms[room_id.toUpperCase()] = room;
    saveRooms(rooms);

    console.log(`[ADD-MEMBER] Friend "${member.display_name}" added to room: ${room_id.toUpperCase()} (Total members: ${room.members.length})`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(room));
    return;
  }

  // --- API: Log Problem ---
  if (pathname === '/api/room/log' && req.method === 'POST') {
    const body = await getRequestBody(req);
    const { room_id, log } = body;

    if (!room_id || !log) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing room_id or log.' }));
      return;
    }

    const rooms = loadRooms();
    const room = rooms[room_id.toUpperCase()];

    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Room ${room_id} not found.` }));
      return;
    }

    if (!room.manual_logs) room.manual_logs = [];
    room.manual_logs.push(log);
    rooms[room_id.toUpperCase()] = room;
    saveRooms(rooms);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(room));
    return;
  }

  // --- API: Delete Log ---
  if (pathname === '/api/room/delete-log' && req.method === 'POST') {
    const body = await getRequestBody(req);
    const { room_id, log_id } = body;

    if (!room_id || !log_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing room_id or log_id.' }));
      return;
    }

    const rooms = loadRooms();
    const room = rooms[room_id.toUpperCase()];

    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Room ${room_id} not found.` }));
      return;
    }

    room.manual_logs = (room.manual_logs || []).filter(l => l.log_id !== log_id);
    rooms[room_id.toUpperCase()] = room;
    saveRooms(rooms);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(room));
    return;
  }

  // --- API: Restore Room (Self-healing fallback) ---
  if (pathname === '/api/room/restore' && req.method === 'POST') {
    const body = await getRequestBody(req);
    const { room } = body;

    if (!room || !room.room_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing room object.' }));
      return;
    }

    const rooms = loadRooms();
    rooms[room.room_id.toUpperCase()] = room;
    saveRooms(rooms);

    console.log(`[RESTORE] Room self-healed/restored: ${room.room_id.toUpperCase()} (Total active rooms: ${Object.keys(rooms).length})`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(room));
    return;
  }

  // --- STATIC FILES SERVING (with Vercel rewrites emulation) ---
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);

  if (!ext) {
    filePath = path.join(__dirname, 'index.html');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(__dirname, 'index.html');
    }

    const fileExt = path.extname(filePath);
    const contentType = MIME_TYPES[fileExt] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  const rooms = loadRooms();
  const count = Object.keys(rooms).length;
  console.log(`Lurk Sync Server running at http://localhost:${PORT}/`);
  console.log(`[STARTUP] Loaded ${count} active rooms from persistent database.`);
});
