// Newsletter subscription server
// Runs alongside nginx on Oracle Cloud, handles POST /api/subscribe
// Start with PM2:  pm2 start server.js --name portfolio

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Load .env file if present (no dotenv package needed) ─────────────────────
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const PORT    = process.env.PORT     || 3001;
const API_KEY = process.env.MJ_API_KEY;
const SECRET  = process.env.MJ_SECRET;
const LIST_ID = parseInt(process.env.MJ_LIST_ID, 10);

if (!API_KEY || !SECRET || !LIST_ID) {
  console.error('ERROR: Missing MJ_API_KEY, MJ_SECRET, or MJ_LIST_ID in .env');
  process.exit(1);
}

const AUTH = Buffer.from(`${API_KEY}:${SECRET}`).toString('base64');
console.log(`MailJet list ID: ${LIST_ID}`);

// ── MailJet API helper ────────────────────────────────────────────────────────
function mjPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.mailjet.com',
      path,
      method: 'POST',
      headers: {
        'Authorization':  `Basic ${AUTH}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── CORS helper — allow any origin for /api/subscribe ────────────────────────
// (nginx already restricts what reaches this server, so this is safe)
function setCORS(res, reqOrigin) {
  res.setHeader('Access-Control-Allow-Origin', reqOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCORS(res, req.headers.origin);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/subscribe') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      const json = k => { res.writeHead(k, { 'Content-Type': 'application/json' }); };
      try {
        const { email } = JSON.parse(raw);

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          json(400); return res.end(JSON.stringify({ error: 'Invalid email' }));
        }

        console.log(`[subscribe] ${email}`);

        // 1. Create contact (400 = already exists, that's fine)
        const c = await mjPost('/v3/REST/contact', { Email: email });
        console.log(`[MJ contact] ${c.status}`, JSON.stringify(c.body).slice(0, 120));
        if (c.status !== 201 && c.status !== 400) {
          throw new Error(`Contact failed: ${c.status} ${c.body?.ErrorMessage || ''}`);
        }

        // 2. Subscribe to list (400 = already subscribed, fine)
        const s = await mjPost('/v3/REST/listrecipient', {
          ContactAlt:    email,
          ListID:        LIST_ID,
          IsUnsubscribed: false,
        });
        console.log(`[MJ list]    ${s.status}`, JSON.stringify(s.body).slice(0, 120));
        if (s.status !== 201 && s.status !== 400) {
          throw new Error(`List failed: ${s.status} ${s.body?.ErrorMessage || ''}`);
        }

        json(200); res.end(JSON.stringify({ success: true }));

      } catch (err) {
        console.error('[subscribe error]', err.message);
        json(500); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () =>
  console.log(`Subscribe server listening on 127.0.0.1:${PORT}`)
);
