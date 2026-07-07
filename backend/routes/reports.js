const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// M01: N8N base URL — internal Docker hostname in production.
const N8N_INTERNAL = process.env.N8N_INTERNAL_URL || 'http://pelindo-n8n:5678';

// Helper: fetch device history from N8N.
// C6 same hardening: redirect:'manual', single source of truth, server-side.
async function fetchHistory(deviceId, fromIso, toIso) {
  const url = new URL(`${N8N_INTERNAL}/webhook/device-history`);
  url.searchParams.set('deviceId', deviceId);
  url.searchParams.set('createdDate_gte', fromIso);
  url.searchParams.set('createdDate_lte', toIso);
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) throw new Error('Upstream redirect');
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Upstream format error');
  return data;
}

// GET /api/reports/:deviceId?from=ISO&to=ISO&format=csv
// Auth required. Returns CSV stream with speed + distance per point.
router.get('/:deviceId', authMiddleware, async (req, res) => {
  const { deviceId } = req.params;
  const { from, to, format } = req.query;

  if (!deviceId || !from || !to) {
    return res.status(400).json({ error: 'deviceId, from, to wajib diisi' });
  }
  if (format && format !== 'csv') {
    return res.status(400).json({ error: 'Format belum didukung (hanya csv)' });
  }

  // Bound the time range to 30 days to avoid huge N8N queries.
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return res.status(400).json({ error: 'from/to harus ISO timestamp' });
  }
  if (toMs - fromMs > 30 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'Rentang waktu maksimal 30 hari' });
  }
  if (toMs <= fromMs) {
    return res.status(400).json({ error: 'to harus lebih besar dari from' });
  }

  try {
    const data = await fetchHistory(deviceId, new Date(fromMs).toISOString(), new Date(toMs).toISOString());

    // Sort chronologically (N8N doesn't guarantee order)
    data.sort((a, b) => {
      if (a.createdDate && b.createdDate) return new Date(a.createdDate) - new Date(b.createdDate);
      if (a._id && b._id) return a._id.localeCompare(b._id);
      return 0;
    });

    // Compute per-point speed (km/h) + cumulative distance (m).
    // haversine = accurate enough for short segments, no Leaflet dep.
    const R = 6371000; // earth radius meters
    const toRad = d => d * Math.PI / 180;
    const distM = (a, b) => {
      const dLat = toRad(b.lat - a.lat);
      const dLon = toRad(b.lon - a.lon);
      const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
      const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(x));
    };

    const rows = [['timestamp_wib', 'latitude', 'longitude', 'speed_kmh', 'distance_m_from_prev', 'cumulative_distance_m']];
    let cum = 0;
    let prev = null;
    for (const p of data) {
      const lat = parseFloat(p.latitude);
      const lon = parseFloat(p.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const ts = p.createdDate ? new Date(p.createdDate) : null;
      const tsWib = ts ? ts.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).replace(' ', 'T') + '+07:00' : '';
      let speed = 0, segDist = 0;
      if (prev) {
        segDist = distM(prev, { lat, lon });
        cum += segDist;
        if (ts && prev.ts) {
          const dt = (ts - prev.ts) / 1000;
          if (dt > 0) speed = Math.min(150, (segDist / dt) * 3.6); // cap 150 km/h same as chart
        }
      }
      rows.push([
        tsWib,
        lat.toFixed(6),
        lon.toFixed(6),
        speed.toFixed(2),
        segDist.toFixed(2),
        cum.toFixed(2),
      ]);
      prev = { lat, lon, ts };
    }

    // CSV-safe escape (quote if contains comma/quote/newline)
    const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const csv = rows.map(r => r.map(esc).join(',')).join('\n');

    const filename = `laporan-${deviceId}-${from.slice(0, 10)}-${to.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('reports error:', err.message);
    res.status(500).json({ error: 'Gagal membuat laporan', details: err.message });
  }
});

module.exports = router;
