const express = require('express');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// C6: dedicated login limiter for device endpoints — heavier than user login
//   because each device is one physical tablet; if it exceeds 10 attempts/15min
//   either the tablet is misconfigured or someone is brute-forcing PPT codes.
const deviceLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Terlalu banyak percobaan login device. Coba lagi 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// M01: get N8N base URL from env, default to internal Docker hostname.
//   Endpoint serves only ONE device's data on success — never the full list,
//   so the device-cordinate enumeration is closed off.
const N8N_INTERNAL = process.env.N8N_INTERNAL_URL || 'http://pelindo-n8n:5678';

router.post('/login', deviceLoginLimiter, async (req, res) => {
  const { pptCode, serialNumber } = req.body || {};

  if (typeof pptCode !== 'string' || typeof serialNumber !== 'string') {
    return res.status(400).json({ success: false, message: 'pptCode dan serialNumber wajib diisi' });
  }

  // C6: bind by serialNumber (hardware-persistent), then require matching PPT code.
  //   Server fetches N8N ONCE per request, finds the device, validates the
  //   code against the response, returns ONLY that device. The N8N response
  //   is never echoed to the client.
  try {
    const upstream = await fetch(`${N8N_INTERNAL}/webhook/device-cordinate`, {
      redirect: 'manual',
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return res.status(502).json({ success: false, message: 'Upstream redirect' });
    }
    const data = await upstream.json();
    if (!Array.isArray(data)) {
      return res.status(502).json({ success: false, message: 'Upstream format error' });
    }

    const match = data.find(d => d.serialNumber === serialNumber);
    if (!match) {
      return res.status(404).json({ success: false, message: 'Device tidak terdaftar' });
    }
    if (match.pptCode !== pptCode) {
      return res.status(401).json({ success: false, message: 'PPT Code tidak valid atau kadaluarsa' });
    }

    return res.json({
      success: true,
      device: {
        id: match.deviceId,
        name: match.serialNumber || match.deviceId,
        tags: match.deviceTags || [],
        pptCode: match.pptCode,
      },
    });
  } catch (err) {
    console.error('device-login error:', err.message);
    return res.status(500).json({ success: false, message: 'Gagal memverifikasi device' });
  }
});

module.exports = router;
