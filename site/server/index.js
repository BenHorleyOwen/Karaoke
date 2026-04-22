import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

const PORT = 5020;
const NAVIDROME_URL = process.env.NAVIDROME_URL || 'http://navidrome:4533';
const NAV_USER = process.env.NAVIDROME_USER || 'Karaoke';
const NAV_PASS = process.env.NAVIDROME_PASS || 'Karaoke';

// ── Subsonic auth params ─────────────────────────────────────────────────────
function subsonicParams(extra = {}) {
  const salt = Math.random().toString(36).slice(2);
  const token = createHash('md5').update(NAV_PASS + salt).digest('hex');
  return new URLSearchParams({
    u: NAV_USER,
    t: token,
    s: salt,
    v: '1.16.1',
    c: 'karaoke',
    f: 'json',
    ...extra,
  });
}

// ── Serve static frontend ────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ── Proxy: search songs ──────────────────────────────────────────────────────
app.get('/api/songs', async (req, res) => {
  try {
    const query = req.query.q || '';
    const endpoint = query ? 'search3' : 'getStarred2';
    const extra = query ? { query, songCount: 50 } : {};
    const params = subsonicParams(extra);
    const url = `${NAVIDROME_URL}/rest/${endpoint}?${params}`;
    const response = await fetch(url);
    const data = await response.json();
    const root = data['subsonic-response'];

    let songs = [];
    if (query) {
      songs = root?.searchResult3?.song || [];
    } else {
      // fallback: get random songs if nothing starred
      const p2 = subsonicParams({ size: 50, type: 'random' });
      const r2 = await fetch(`${NAVIDROME_URL}/rest/getRandomSongs?${p2}`);
      const d2 = await r2.json();
      songs = d2['subsonic-response']?.randomSongs?.song || [];
    }

    res.json(songs);
  } catch (err) {
    console.error('Songs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Proxy: stream audio ──────────────────────────────────────────────────────
app.get('/api/stream/:id', async (req, res) => {
  try {
    const params = subsonicParams({ id: req.params.id });
    const url = `${NAVIDROME_URL}/rest/stream?${params}`;
    const upstream = await fetch(url);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    const reader = upstream.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(value);
      pump();
    };
    pump();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Lyrics: Navidrome first, LRCLIB fallback ─────────────────────────────────
app.get('/api/lyrics', async (req, res) => {
  const { artist, title, duration } = req.query;

  // 1. Try Navidrome getLyrics
  try {
    const params = subsonicParams({ artist, title });
    const url = `${NAVIDROME_URL}/rest/getLyrics?${params}`;
    const r = await fetch(url);
    const d = await r.json();
    const lyrics = d['subsonic-response']?.lyrics;
    if (lyrics?.value?.trim()) {
      return res.json({ synced: false, lines: lyrics.value.split('\n') });
    }
  } catch (_) {}

  // 2. Try LRCLIB for synced lyrics
  try {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    if (duration) params.set('duration', duration);
    const r = await fetch(`https://lrclib.net/api/get?${params}`);
    if (r.ok) {
      const d = await r.json();
      if (d.syncedLyrics) {
        const lines = parseLrc(d.syncedLyrics);
        return res.json({ synced: true, lines });
      }
      if (d.plainLyrics) {
        return res.json({ synced: false, lines: d.plainLyrics.split('\n') });
      }
    }
  } catch (_) {}

  res.json({ synced: false, lines: [] });
});

// ── LRC parser ───────────────────────────────────────────────────────────────
function parseLrc(lrc) {
  return lrc.split('\n')  
    .map(line => {
      const m = line.match(/^\[(\d+):(\d+\.\d+)\](.*)/);
      if (!m) return null;
      const time = parseInt(m[1]) * 60 + parseFloat(m[2]);
      return { time, text: m[3].trim() };
    })
    .filter(Boolean);
}

//listening on 0.0.0.0 ensures the server listens on all interfaces
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});