const express = require('express');
const router = express.Router();
const path = require('path');
const os = require('os');

const session = {
  startedAt: Date.now(),
  totalBytesOut: 0,
  totalRequests: 0,
  responseTimes: [],
  clients: new Map(),
  peaks: { cpuPercent: 0, ramMB: 0, users: 0, bandwidthMBps: 0 },
  paused: false,
  lastSample: { bytes: 0, time: Date.now() }
};

let prevCpu = os.cpus();
function sampleCpuPercent() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (let i = 0; i < cpus.length; i++) {
    const c = cpus[i].times;
    const p = prevCpu[i].times;
    const idleDiff = c.idle - p.idle;
    const totalDiff = (c.user - p.user) + (c.nice - p.nice) + (c.sys - p.sys) + (c.irq - p.irq) + (c.idle - p.idle);
    idle += idleDiff;
    total += totalDiff;
  }
  prevCpu = cpus;
  if (total === 0) return 0;
  return Math.round((1 - idle / total) * 1000) / 10;
}

function trackRequest(req) {
  if (session.paused) return;
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let client = session.clients.get(ip);
  if (!client) {
    client = { requests: 0, bytesOut: 0, lastSeen: now };
    session.clients.set(ip, client);
  }
  client.requests += 1;
  client.lastSeen = now;
  session.totalRequests += 1;
}

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/monitor.html'));
});

function sendStats(req, res) {
  const cpuPercent = sampleCpuPercent();
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramMB = Math.round(usedMem / 1024 / 1024);
  const ramPercent = Math.round((usedMem / totalMem) * 1000) / 10;

  const now = Date.now();
  const dt = Math.max(0.001, (now - session.lastSample.time) / 1000);
  const dBytes = Math.max(0, session.totalBytesOut - session.lastSample.bytes);
  const bandwidthMBps = Math.round((dBytes / dt / 1024 / 1024) * 1000) / 1000;
  session.lastSample = { bytes: session.totalBytesOut, time: now };

  const activeClients = [];
  for (const [ip, c] of session.clients.entries()) {
    const age = (now - c.lastSeen) / 1000;
    if (age < 120) {
      activeClients.push({
        ip,
        requests: c.requests,
        bytesOutMB: Math.round((c.bytesOut / 1024 / 1024) * 100) / 100,
        lastSeenSec: Math.round(age)
      });
    }
  }
  activeClients.sort((a, b) => b.requests - a.requests);
  const concurrentUsers = activeClients.length;

  const times = session.responseTimes.slice(-200);
  const avgMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted.length ? (sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1]) : 0;

  if (cpuPercent > session.peaks.cpuPercent) session.peaks.cpuPercent = cpuPercent;
  if (ramMB > session.peaks.ramMB) session.peaks.ramMB = ramMB;
  if (concurrentUsers > session.peaks.users) session.peaks.users = concurrentUsers;
  if (bandwidthMBps > session.peaks.bandwidthMBps) session.peaks.bandwidthMBps = bandwidthMBps;

  let suggestedRAM = '1 GB', suggestedCPU = '1 vCPU', suggestedTraffic = '1 TB';
  let notes = 'Light traffic — shared hosting or small VPS is fine.';
  if (session.peaks.users > 20 || session.peaks.ramMB > 800) {
    suggestedRAM = '2 GB'; suggestedCPU = '2 vCPU'; suggestedTraffic = '2 TB';
    notes = 'Moderate load — consider a small dedicated VPS.';
  }
  if (session.peaks.users > 80 || session.peaks.bandwidthMBps > 5) {
    suggestedRAM = '4 GB+'; suggestedCPU = '4 vCPU'; suggestedTraffic = '5 TB+';
    notes = 'Higher load — use a larger VPS or CDN in front of tiles.';
  }

  const uptimeSec = Math.floor((now - session.startedAt) / 1000);
  const totalDataMB = Math.round((session.totalBytesOut / 1024 / 1024) * 100) / 100;
  const hours = Math.max(uptimeSec / 3600, 0.01);
  const estMonthlyGB = Math.round((totalDataMB / 1024 / hours) * 24 * 30 * 10) / 10;

  let keyStats = { total: 0, active: 0, byKey: [] };
  try {
    const data = req.app.locals.reloadKeys();
    keyStats.total = data.keys.length;
    keyStats.active = data.keys.filter(k => k.active).length;
    keyStats.byKey = data.keys.map(k => ({ id: k.id, name: k.name, usage: k.usage || 0, active: k.active }));
  } catch (_) {}

  res.json({
    cpuPercent,
    ram: { usedMB: ramMB, totalMB: Math.round(totalMem / 1024 / 1024), percent: ramPercent, processMB: Math.round(mem.rss / 1024 / 1024) },
    concurrentUsers,
    bandwidthMBps,
    totalDataMB,
    avgResponseMs: avgMs,
    p95ResponseMs: p95,
    peaks: { ...session.peaks },
    clients: activeClients.slice(0, 50),
    recommendation: { suggestedRAM, suggestedCPU, suggestedTraffic, notes },
    estimatedMonthlyTrafficGB: estMonthlyGB,
    uptimeSec,
    totalRequests: session.totalRequests,
    keys: keyStats,
    paused: session.paused,
    timestamp: new Date().toISOString()
  });
}

router.get('/api/stats', sendStats);
router.get('/api/monitor', sendStats);

router.post('/api/monitor/reset', (req, res) => {
  session.startedAt = Date.now();
  session.totalBytesOut = 0;
  session.totalRequests = 0;
  session.responseTimes = [];
  session.clients.clear();
  session.peaks = { cpuPercent: 0, ramMB: 0, users: 0, bandwidthMBps: 0 };
  session.lastSample = { bytes: 0, time: Date.now() };
  res.json({ success: true });
});
router.post('/api/monitor/pause', (req, res) => { session.paused = true; res.json({ success: true, paused: true }); });
router.post('/api/monitor/resume', (req, res) => { session.paused = false; res.json({ success: true, paused: false }); });

// Also expose under /monitor paths used by some UIs
router.post('/reset', (req, res) => {
  session.startedAt = Date.now();
  session.totalBytesOut = 0;
  session.totalRequests = 0;
  session.responseTimes = [];
  session.clients.clear();
  session.peaks = { cpuPercent: 0, ramMB: 0, users: 0, bandwidthMBps: 0 };
  session.lastSample = { bytes: 0, time: Date.now() };
  res.json({ success: true });
});

router.trackRequest = trackRequest;
router.recordBytes = (ip, bytes) => {
  if (session.paused) return;
  session.totalBytesOut += bytes || 0;
  const client = session.clients.get(ip);
  if (client) client.bytesOut += bytes || 0;
};
router.recordResponseTime = (ms) => {
  session.responseTimes.push(ms);
  if (session.responseTimes.length > 500) session.responseTimes.shift();
};

module.exports = router;
