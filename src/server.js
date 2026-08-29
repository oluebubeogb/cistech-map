const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const appConfig = require('../config/app.json');
const mapStyle = require('../data/map-style.json');

const apiRoutes = require('./routes/api');
const devRoutes = require('./routes/dev');
const monitorRoutes = require('./routes/monitor');
const { attachWebSocketServer } = require('./lib/wsServer');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || appConfig.port;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow MapLibre and CDN scripts
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Make config available
app.locals.appConfig = appConfig;
app.locals.mapStyle = mapStyle;

// Helper to reload config (for live style updates)
app.locals.reloadStyle = () => {
  try {
    delete require.cache[require.resolve('../data/map-style.json')];
    app.locals.mapStyle = require('../data/map-style.json');
    return true;
  } catch (e) {
    return false;
  }
};

app.locals.reloadKeys = () => {
  try {
    delete require.cache[require.resolve('../data/api-keys.json')];
    return require('../data/api-keys.json');
  } catch (e) {
    return { keys: [] };
  }
};

// Routes
// Lightweight request tracking for monitor
app.use((req, res, next) => {
  const start = Date.now();
  try { monitorRoutes.trackRequest && monitorRoutes.trackRequest(req); } catch (_) {}
  const origEnd = res.end;
  res.end = function (...args) {
    try {
      const ms = Date.now() - start;
      monitorRoutes.recordResponseTime && monitorRoutes.recordResponseTime(ms);
      const len = parseInt(res.getHeader('content-length') || '0', 10) || 0;
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
      monitorRoutes.recordBytes && monitorRoutes.recordBytes(ip, len);
    } catch (_) {}
    return origEnd.apply(this, args);
  };
  next();
});

app.use('/api', apiRoutes);
app.use(`/${appConfig.devPath}`, devRoutes);
app.use('/monitor', monitorRoutes);

// Main map page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// View map alias
app.get('/view-map', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const {
  resolveKeyFeatures,
  keyWasProvided
} = require('./lib/apiKeys');

// Embed endpoint — serves the SAME app as the main map (index.html + map.js),
// not a separate hand-built widget. This is what makes an enterprise key
// show the full toolbar/UI in the iframe, exactly like the standalone app —
// map.js already reads enabledFeatures and shows/hides everything from
// there, so a free/pro key naturally gets a reduced UI here too, with no
// second copy of the feature logic to maintain or drift out of sync.
app.get('/embed', (req, res) => {
  const { key, features, valid } = resolveKeyFeatures(req);
  // Explicit but invalid/empty key → hard reject (never free-tier fallback)
  if (keyWasProvided(req) && !valid) {
    return res.status(403).send('Invalid or inactive API key.');
  }
  if (key && valid && !(features.includes('share_embed') || features.includes('embed'))) {
    return res.status(403).send('This API key is not authorized to embed this map.');
  }
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Admin submissions review page
app.get('/submissions', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/submissions.html'));
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Mahp', version: '1.0.0' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// WebSocket for share-screen realtime (/ws/share-screen)
attachWebSocketServer(server, () => app.locals.appConfig);

server.listen(PORT, () => {
  console.log(`\n🗺️  Mahp Map Service running`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Map:      http://localhost:${PORT}/`);
  console.log(`   Dev:      http://localhost:${PORT}/${appConfig.devPath}`);
  console.log(`   Monitor:  http://localhost:${PORT}/monitor`);
  console.log(`   Embed:    http://localhost:${PORT}/embed`);
  console.log(`   WS:       ws://localhost:${PORT}/ws/share-screen`);
  console.log(`\n   Cloudflare Tunnel target: map.collab.name.ng → localhost:${PORT}\n`);
});
