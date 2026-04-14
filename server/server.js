import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'eurovision-party.sqlite');
const db = new sqlite3.Database(dbPath);

const EUROVISION_COUNTRIES = [
  { name: 'Albania', flag: '🇦🇱' },
  { name: 'Armenia', flag: '🇦🇲' },
  { name: 'Australia', flag: '🇦🇺' },
  { name: 'Austria', flag: '🇦🇹' },
  { name: 'Azerbaijan', flag: '🇦🇿' },
  { name: 'Belgium', flag: '🇧🇪' },
  { name: 'Croatia', flag: '🇭🇷' },
  { name: 'Cyprus', flag: '🇨🇾' },
  { name: 'Czechia', flag: '🇨🇿' },
  { name: 'Denmark', flag: '🇩🇰' },
  { name: 'Estonia', flag: '🇪🇪' },
  { name: 'Finland', flag: '🇫🇮' },
  { name: 'France', flag: '🇫🇷' },
  { name: 'Georgia', flag: '🇬🇪' },
  { name: 'Germany', flag: '🇩🇪' },
  { name: 'Greece', flag: '🇬🇷' },
  { name: 'Iceland', flag: '🇮🇸' },
  { name: 'Ireland', flag: '🇮🇪' },
  { name: 'Israel', flag: '🇮🇱' },
  { name: 'Italy', flag: '🇮🇹' },
  { name: 'Latvia', flag: '🇱🇻' },
  { name: 'Lithuania', flag: '🇱🇹' },
  { name: 'Luxembourg', flag: '🇱🇺' },
  { name: 'Malta', flag: '🇲🇹' },
  { name: 'Montenegro', flag: '🇲🇪' },
  { name: 'Netherlands', flag: '🇳🇱' },
  { name: 'Norway', flag: '🇳🇴' },
  { name: 'Poland', flag: '🇵🇱' },
  { name: 'Portugal', flag: '🇵🇹' },
  { name: 'San Marino', flag: '🇸🇲' },
  { name: 'Serbia', flag: '🇷🇸' },
  { name: 'Slovenia', flag: '🇸🇮' },
  { name: 'Spain', flag: '🇪🇸' },
  { name: 'Sweden', flag: '🇸🇪' },
  { name: 'Switzerland', flag: '🇨🇭' },
  { name: 'Ukraine', flag: '🇺🇦' },
  { name: 'United Kingdom', flag: '🇬🇧' }
];

const CATEGORIES = [
  'Vocals',
  'Costume',
  'Choreography',
  'Special Effects',
  'Originality',
  'Stage Presence',
  'Crowd Appeal',
  'Overall Impact'
];

const app = express();
const server = http.createServer(app);
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*';
const io = new Server(server, { cors: { origin: allowedOrigins } });

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const ensureColumn = async (tableName, columnName, definition) => {
  const columns = await all(`PRAGMA table_info(${tableName})`);
  const hasColumn = columns.some((column) => column.name === columnName);
  if (!hasColumn) {
    await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
};

const initDb = async () => {
  await run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT 'Eurovision Party',
    current_country_index INTEGER DEFAULT 0,
    voting_locked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await ensureColumn('sessions', 'phase', "TEXT DEFAULT 'scoring'");
  await ensureColumn('sessions', 'results_country_index', 'INTEGER');
  await ensureColumn('sessions', 'selected_country_id', 'INTEGER');
  await ensureColumn('sessions', 'scoring_country_id', 'INTEGER');

  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS countries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    flag TEXT NOT NULL,
    performance_order INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    country_id INTEGER NOT NULL,
    total_score INTEGER NOT NULL,
    breakdown_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, country_id)
  )`);

  const countryCount = await get('SELECT COUNT(*) as count FROM countries');
  if (!countryCount?.count) {
    for (let i = 0; i < EUROVISION_COUNTRIES.length; i++) {
      const country = EUROVISION_COUNTRIES[i];
      await run('INSERT INTO countries (name, flag, performance_order) VALUES (?, ?, ?)', [country.name, country.flag, i]);
    }
  }

  const sessionCount = await get('SELECT COUNT(*) as count FROM sessions');
  if (!sessionCount?.count) {
    await run('INSERT INTO sessions (name, current_country_index, voting_locked, phase, results_country_index, selected_country_id, scoring_country_id) VALUES (?, ?, ?, ?, ?, ?, ?)', ['Eurovision Party', 0, 0, 'preshow', null, null, null]);
  } else {
    await run("UPDATE sessions SET phase = COALESCE(phase, 'scoring') WHERE phase IS NULL");
  }
};

const buildResultsView = async (countries, users, scores, resultsCountryIndex) => {
  if (resultsCountryIndex === null || resultsCountryIndex === undefined) return null;
  const country = countries[resultsCountryIndex] || null;
  if (!country) return null;

  const countryScores = scores.filter((score) => score.country_id === country.id);
  const votes = users
    .map((user) => {
      const score = countryScores.find((entry) => entry.user_id === user.id);
      let breakdown = null;
      if (score?.breakdown_json) {
        try { breakdown = JSON.parse(score.breakdown_json); } catch {}
      }
      return {
        userId: user.id,
        first_name: user.first_name,
        is_admin: user.is_admin,
        submitted: Boolean(score),
        totalScore: score ? score.total_score : null,
        breakdown
      };
    })
    .sort((a, b) => {
      if (a.submitted && b.submitted) return b.totalScore - a.totalScore || a.first_name.localeCompare(b.first_name);
      if (a.submitted) return -1;
      if (b.submitted) return 1;
      return a.first_name.localeCompare(b.first_name);
    });

  const leaderboard = countries
    .map((entry) => {
      const entryScores = scores.filter((score) => score.country_id === entry.id);
      return {
        countryId: entry.id,
        totalScore: entryScores.reduce((sum, score) => sum + score.total_score, 0),
        performance_order: entry.performance_order
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.performance_order - b.performance_order);

  const position = leaderboard.findIndex((entry) => entry.countryId === country.id) + 1;
  const countryTotal = countryScores.reduce((sum, score) => sum + score.total_score, 0);

  return {
    country,
    votes,
    countryTotal,
    submittedBy: countryScores.length,
    leaderboardPosition: position || null,
    totalCountriesRanked: countries.length
  };
};

const buildFinalResults = async (countries, users, scores) => {
  const countryResults = countries.map((country) => {
    const countryScores = scores.filter((s) => s.country_id === country.id);
    const totalScore = countryScores.reduce((sum, s) => sum + s.total_score, 0);
    const votes = users.map((user) => {
      const score = countryScores.find((s) => s.user_id === user.id);
      return {
        userId: user.id,
        first_name: user.first_name,
        totalScore: score ? score.total_score : 0,
        submitted: Boolean(score)
      };
    });
    return { ...country, totalScore, votes };
  }).sort((a, b) => b.totalScore - a.totalScore || a.performance_order - b.performance_order);

  const playerRankings = users.map((user) => {
    const userScores = scores.filter((s) => s.user_id === user.id);
    const grandTotal = userScores.reduce((sum, s) => sum + s.total_score, 0);
    const countriesVoted = userScores.length;
    const topScore = [...userScores].sort((a, b) => b.total_score - a.total_score)[0];
    const fav = topScore ? countries.find((c) => c.id === topScore.country_id) : null;
    return {
      id: user.id,
      first_name: user.first_name,
      is_admin: user.is_admin,
      grandTotal,
      countriesVoted,
      favouriteCountryName: fav?.name || null,
      favouriteCountryFlag: fav?.flag || null
    };
  }).sort((a, b) => b.grandTotal - a.grandTotal);

  return {
    countryResults,
    playerRankings,
    winner: countryResults[0] || null,
    totalCountries: countries.length,
    totalVoters: users.length
  };
};

const getSessionState = async () => {
  const session = await get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
  const countries = await all('SELECT * FROM countries ORDER BY performance_order ASC');
  const users = await all('SELECT * FROM users ORDER BY created_at ASC');
  const scores = await all('SELECT * FROM scores');
  const selectedCountryId = session?.selected_country_id ?? null;
  const scoringCountryId = session?.scoring_country_id ?? null;
  const selectedCountryIndex = selectedCountryId ? countries.findIndex((country) => country.id === selectedCountryId) : -1;
  const scoringCountryIndex = scoringCountryId ? countries.findIndex((country) => country.id === scoringCountryId) : -1;
  const currentCountry = (session?.phase === 'preshow')
    ? null
    : selectedCountryIndex >= 0
      ? countries[selectedCountryIndex]
      : scoringCountryIndex >= 0
        ? countries[scoringCountryIndex]
        : countries[session?.current_country_index || 0] || null;

  const userTotals = users.map((user) => {
    const userScores = scores.filter((score) => score.user_id === user.id);
    const totalSubmittedScore = userScores.reduce((sum, score) => sum + score.total_score, 0);
    return {
      ...user,
      submissions: userScores.length,
      totalSubmittedScore
    };
  });

  const leaderboard = countries
    .map((country) => {
      const countryScores = scores.filter((score) => score.country_id === country.id);
      const totalScore = countryScores.reduce((sum, score) => sum + score.total_score, 0);
      const submittedBy = countryScores.length;
      return { ...country, totalScore, submittedBy };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.performance_order - b.performance_order);

  const resultsView = await buildResultsView(countries, users, scores, session?.results_country_index ?? null);
  const finalResults = (session?.phase === 'finished') ? await buildFinalResults(countries, users, scores) : null;

  return {
    session: {
      ...session,
      phase: session?.phase || 'scoring'
    },
    countries,
    users: userTotals,
    currentCountry,
    leaderboard,
    resultsView,
    finalResults
  };
};

await initDb();

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, dbPath, countryCount: EUROVISION_COUNTRIES.length, categories: CATEGORIES.length });
});

app.get('/api/session', async (_req, res) => {
  try {
    res.json(await getSessionState());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/join', async (req, res) => {
  try {
    const firstName = String(req.body.firstName || '').trim();
    if (!firstName) return res.status(400).json({ error: 'First name is required' });

    const existingUsers = await all('SELECT * FROM users ORDER BY created_at ASC');
    const normalized = firstName.toLowerCase();
    const existingUser = existingUsers.find((u) => String(u.first_name).trim().toLowerCase() === normalized);

    if (existingUser) {
      const session = await get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
      if ((session?.phase || 'scoring') === 'intro' && session?.selected_country_id == null) {
        const countries = await all('SELECT * FROM countries ORDER BY performance_order ASC');
        const currentCountryId = countries[session?.current_country_index || 0]?.id;
        const alreadyScoredIds = new Set((await all('SELECT DISTINCT country_id FROM scores')).map((row) => row.country_id));
        const nextAvailable = countries.find((country) => country.id !== currentCountryId && !alreadyScoredIds.has(country.id));
        if (nextAvailable) {
          await run('UPDATE sessions SET selected_country_id = ? WHERE id = ?', [nextAvailable.id, session.id]);
        }
      }
      const state = await getSessionState();
      io.emit('lobby:notice', {
        type: 'rejoin',
        firstName: existingUser.first_name,
        message: `${existingUser.first_name} rejoined the room.`
      });
      io.emit('session:update', state);
      return res.json({ user: existingUser, state, relogin: true });
    }

    const isAdmin = existingUsers.length === 0 ? 1 : 0;
    const result = await run('INSERT INTO users (first_name, is_admin) VALUES (?, ?)', [firstName, isAdmin]);
    const user = await get('SELECT * FROM users WHERE id = ?', [result.lastID]);

    const session = await get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
    if ((session?.phase || 'scoring') === 'intro' && session?.selected_country_id == null) {
      const countries = await all('SELECT * FROM countries ORDER BY performance_order ASC');
      const currentCountryId = countries[session?.current_country_index || 0]?.id;
      const alreadyScoredIds = new Set((await all('SELECT DISTINCT country_id FROM scores')).map((row) => row.country_id));
      const nextAvailable = countries.find((country) => country.id !== currentCountryId && !alreadyScoredIds.has(country.id));
      if (nextAvailable) {
        await run('UPDATE sessions SET selected_country_id = ? WHERE id = ?', [nextAvailable.id, session.id]);
      }
    }

    const state = await getSessionState();
    io.emit('lobby:notice', {
      type: 'join',
      firstName: user.first_name,
      message: `${user.first_name} joined the room.`
    });
    io.emit('session:update', state);
    res.json({ user, state, relogin: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/score', async (req, res) => {
  try {
    const userId = Number(req.body.userId);
    const breakdown = req.body.breakdown || {};
    const session = await get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
    const countries = await all('SELECT * FROM countries ORDER BY performance_order ASC');
    const currentCountry = countries[session?.current_country_index || 0];
    if (!userId || !currentCountry) return res.status(400).json({ error: 'Missing current session or user' });
    if ((session?.phase || 'scoring') !== 'scoring') return res.status(400).json({ error: 'Voting is currently closed' });

    const totalScore = CATEGORIES.reduce((sum, category) => sum + Number(breakdown[category] || 0), 0);
    const existing = await get('SELECT * FROM scores WHERE user_id = ? AND country_id = ?', [userId, currentCountry.id]);

    if (existing) {
      await run('UPDATE scores SET total_score = ?, breakdown_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [totalScore, JSON.stringify(breakdown), existing.id]);
    } else {
      await run('INSERT INTO scores (user_id, country_id, total_score, breakdown_json) VALUES (?, ?, ?, ?)', [userId, currentCountry.id, totalScore, JSON.stringify(breakdown)]);
    }

    const state = await getSessionState();
    io.emit('session:update', state);
    res.json({ ok: true, totalScore, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/next-country', async (req, res) => {
  try {
    const userId = Number(req.body.userId);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user?.is_admin) return res.status(403).json({ error: 'Leader access required' });

    const session = await get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
    const countries = await all('SELECT * FROM countries ORDER BY performance_order ASC');
    const currentIndex = session?.current_country_index || 0;
    const phase = session?.phase || 'scoring';

    if (phase === 'preshow') {
      if (session?.selected_country_id == null) {
        return res.status(400).json({ error: 'Choose the first country before starting the show' });
      }
      const selectedIndex = countries.findIndex((country) => country.id === session.selected_country_id);
      if (selectedIndex < 0) {
        return res.status(400).json({ error: 'Selected country could not be found' });
      }
      await run('UPDATE sessions SET current_country_index = ?, phase = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', [selectedIndex, 'scoring-intro', null, session.selected_country_id, session.id]);
    } else if (phase === 'scoring') {
      await run('UPDATE sessions SET phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', ['results', currentIndex, null, null, session.id]);
    } else if (phase === 'results') {
      const remainingCountries = countries.filter((country) => country.performance_order > currentIndex);
      if (!remainingCountries.length) {
        await run('UPDATE sessions SET phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', ['finished', currentIndex, null, null, session.id]);
      } else {
        await run('UPDATE sessions SET phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', ['intro', null, null, null, session.id]);
      }
    } else if (phase === 'intro') {
      if (session?.selected_country_id == null) {
        return res.status(400).json({ error: 'Choose the next country before starting scoring' });
      }
      const selectedIndex = countries.findIndex((country) => country.id === session.selected_country_id);
      if (selectedIndex < 0) {
        return res.status(400).json({ error: 'Selected country could not be found' });
      }
      await run('UPDATE sessions SET current_country_index = ?, phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', [selectedIndex, 'scoring-intro', null, null, session.selected_country_id, session.id]);
    } else if (phase === 'scoring-intro') {
      await run('UPDATE sessions SET phase = ?, scoring_country_id = ? WHERE id = ?', ['scoring', null, session.id]);
    }

    const state = await getSessionState();
    io.emit('session:update', state);
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/previous-country', async (req, res) => {
  try {
    const userId = Number(req.body.userId);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user?.is_admin) return res.status(403).json({ error: 'Leader access required' });

    const session = await get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
    const currentIndex = session?.current_country_index || 0;
    const phase = session?.phase || 'scoring';

    if (phase === 'finished') {
      await run('UPDATE sessions SET phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', ['results', currentIndex, null, null, session.id]);
    } else if (phase === 'results') {
      await run('UPDATE sessions SET phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', ['scoring', null, null, null, session.id]);
    } else if (phase === 'intro') {
      await run('UPDATE sessions SET phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', ['results', currentIndex, null, null, session.id]);
    } else if (phase === 'scoring-intro') {
      await run('UPDATE sessions SET phase = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', ['intro', session.current_country_index, null, session.id]);
    } else {
      const prevIndex = Math.max(currentIndex - 1, 0);
      await run('UPDATE sessions SET current_country_index = ?, phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', [prevIndex, 'scoring', null, null, null, session.id]);
    }

    const state = await getSessionState();
    io.emit('session:update', state);
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/select-country', async (req, res) => {
  try {
    const userId = Number(req.body.userId);
    const selectedCountryId = Number(req.body.countryId);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user?.is_admin) return res.status(403).json({ error: 'Leader access required' });

    const session = await get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
    if (!['intro', 'preshow'].includes(session?.phase || 'scoring')) {
      return res.status(400).json({ error: 'Country selection is only available before scoring starts' });
    }

    const countries = await all('SELECT * FROM countries ORDER BY performance_order ASC');
    const currentCountryId = countries[session?.current_country_index || 0]?.id;
    const alreadyScoredIds = new Set((await all('SELECT DISTINCT country_id FROM scores')).map((row) => row.country_id));
    const selectedCountry = countries.find((country) => country.id === selectedCountryId);

    if (!selectedCountry) {
      return res.status(404).json({ error: 'Country not found' });
    }

    if (selectedCountry.id === currentCountryId || alreadyScoredIds.has(selectedCountry.id)) {
      return res.status(400).json({ error: 'That country has already been performed' });
    }

    await run('UPDATE sessions SET selected_country_id = ? WHERE id = ?', [selectedCountry.id, session.id]);

    const state = await getSessionState();
    io.emit('session:update', state);
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/simulate-finale', async (req, res) => {
  try {
    const userId = Number(req.body.userId);
    const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user?.is_admin) return res.status(403).json({ error: 'Leader access required' });

    const session = await get('SELECT * FROM sessions ORDER BY id DESC LIMIT 1');
    const countries = await all('SELECT * FROM countries ORDER BY performance_order ASC');
    const lastIndex = Math.max(countries.length - 1, 0);

    await run('UPDATE sessions SET current_country_index = ?, phase = ?, results_country_index = ?, selected_country_id = ?, scoring_country_id = ? WHERE id = ?', [lastIndex, 'finished', lastIndex, null, null, session.id]);

    const state = await getSessionState();
    io.emit('session:update', state);
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reset', async (_req, res) => {
  try {
    await run('DELETE FROM scores');
    await run('DELETE FROM users');
    await run('DELETE FROM sessions');
    await run('DELETE FROM countries');
    await initDb();
    const state = await getSessionState();
    io.emit('session:update', state);
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

io.on('connection', async (socket) => {
  socket.emit('connected', { ok: true });
  socket.emit('session:update', await getSessionState());
});

const PORT = process.env.PORT || 3030;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Eurovision Party server running on http://0.0.0.0:${PORT}`);
});
