// Newsletter subscription server
// Runs alongside nginx on Oracle Cloud, handles POST /api/subscribe
// Start: node server.js  |  Keep alive: pm2 start server.js --name portfolio

const http  = require('http');
const https = require('https');

const PORT     = process.env.PORT     || 3001;
const API_KEY  = process.env.MJ_API_KEY;
const SECRET   = process.env.MJ_SECRET;
const LIST_ID  = process.env.MJ_LIST_ID; // numeric ID from MailJet dashboard

if (!API_KEY || !SECRET || !LIST_ID) {
  console.error('Missing env vars: MJ_API_KEY, MJ_SECRET, MJ_LIST_ID');
  process.exit(1);
}

const AUTH = Buffer.from(`${API_KEY}:${SECRET}`).toString('base64');

// ── MailJet API helper ────────────────────────────────────────────────────────
function mjRequest(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.mailjet.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${AUTH}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS — only allow your own domain
  res.setHeader('Access-Control-Allow-Origin', 'https://shaykas.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/api/subscribe') {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(raw);

        // Basic email validation
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid email' }));
        }

        // 1. Create contact (or silently continue if already exists)
        const contact = await mjRequest('/v3/REST/contact', { Email: email });
        if (contact.status !== 201 && contact.status !== 400) {
          throw new Error(contact.body.ErrorMessage || 'Contact creation failed');
        }

        // 2. Add contact to list
        const sub = await mjRequest('/v3/REST/listrecipient', {
          ContactAlt:    email,
          ListID:        parseInt(LIST_ID, 10),
          IsUnsubscribed: false,
        });
        // 400 here usually means already subscribed — that's fine
        if (sub.status !== 201 && sub.status !== 400) {
          throw new Error(sub.body.ErrorMessage || 'List subscription failed');
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

      } catch (err) {
        console.error('Subscribe error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Subscription failed' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Subscribe server running on 127.0.0.1:${PORT}`);
});
