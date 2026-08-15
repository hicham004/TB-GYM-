import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { store, seedDatabase } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const uploadsDir = path.join(rootDir, 'data', 'uploads');
const port = Number(process.env.API_PORT || 4000);
const jwtSecret = process.env.JWT_SECRET || 'tb-gym-local-dev-secret-change-me';
const cookieName = 'tb_gym_session';

fs.mkdirSync(uploadsDir, { recursive: true });
await seedDatabase();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(morgan('dev'));
app.use('/uploads', express.static(uploadsDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      const base = path.basename(file.originalname || 'upload', ext).replace(/[^a-z0-9_-]+/gi, '-');
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
});

function signUser(user) {
  return jwt.sign({ sub: user.id }, jwtSecret, { expiresIn: '7d' });
}

function getToken(req) {
  const auth = req.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies?.[cookieName];
}

async function getUserFromRequest(req) {
  const token = getToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret);
    return store.rawFind('User', { id: payload.sub });
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function parseSortLimit(req) {
  return {
    sort: req.query.sort || req.body?.sort,
    limit: req.query.limit || req.body?.limit,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'TB Gym API' });
});

app.post('/api/auth/login', async (req, res) => {
  const email = store.normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const user = await store.rawFind('User', { email });

  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  res.cookie(cookieName, signUser(user), cookieOptions());
  res.json(await store.findById('User', user.id));
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(cookieName);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json(await store.findById('User', req.user.id));
});

app.post('/api/users/invite', requireAuth, requireAdmin, async (req, res) => {
  const email = store.normalizeEmail(req.body?.email);
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const existing = await store.rawFind('User', { email });
  if (existing) {
    res.json(await store.findById('User', existing.id));
    return;
  }

  const role = req.body?.role === 'admin' ? 'admin' : 'client';
  const password = req.body?.password || 'client123';
  const created = await store.create('User', {
    email,
    role,
    full_name: req.body?.full_name || email.split('@')[0],
    password_hash: await bcrypt.hash(password, 12),
    is_blocked: false,
    payment_status: 'not_paid',
  }, req.user);

  res.status(201).json(created);
});

app.get('/api/entities/:entity', requireAuth, async (req, res) => {
  res.json(await store.list(req.params.entity, parseSortLimit(req)));
});

app.get('/api/entities/:entity/:id', requireAuth, async (req, res) => {
  const record = await store.findById(req.params.entity, req.params.id);
  if (!record) {
    res.status(404).json({ error: `${req.params.entity} not found` });
    return;
  }
  res.json(record);
});

app.post('/api/entities/:entity/filter', requireAuth, async (req, res) => {
  res.json(await store.filter(req.params.entity, req.body?.criteria || {}, parseSortLimit(req)));
});

app.post('/api/entities/:entity', requireAuth, async (req, res) => {
  res.status(201).json(await store.create(req.params.entity, req.body || {}, req.user));
});

app.patch('/api/entities/:entity/:id', requireAuth, async (req, res) => {
  const record = await store.update(req.params.entity, req.params.id, req.body || {});
  if (!record) {
    res.status(404).json({ error: `${req.params.entity} not found` });
    return;
  }
  res.json(record);
});

app.delete('/api/entities/:entity/:id', requireAuth, async (req, res) => {
  if (!(await store.delete(req.params.entity, req.params.id))) {
    res.status(404).json({ error: `${req.params.entity} not found` });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/integrations/upload-file', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'File is required' });
    return;
  }
  res.status(201).json({ file_url: `/uploads/${req.file.filename}` });
});

app.post('/api/integrations/invoke-llm', requireAuth, (req, res) => {
  const prompt = String(req.body?.prompt || '');
  const quoted = prompt.match(/"([^"]+)"/)?.[1];
  const name = quoted || 'Custom Meal';
  res.json({
    name,
    category: 'Custom',
    calories: 500,
    protein: 35,
    carbs: 45,
    fats: 18,
    fiber: 6,
    sodium: 600,
    servings: 1,
    prep_time_minutes: 10,
    cook_time_minutes: 20,
    ingredients: [
      { name: 'Main ingredient', quantity: '1 serving', quantity_raw: '150 g', quantity_cooked: '120 g', calories: 300, protein: 25, carbs: 20, fats: 10 },
      { name: 'Side ingredient', quantity: '1 serving', quantity_raw: '100 g', quantity_cooked: '100 g', calories: 200, protein: 10, carbs: 25, fats: 8 },
    ],
    preparation_steps: 'AI import is running in local placeholder mode. Edit these steps after import.',
    cooking_tips: 'Connect this endpoint to OpenAI when you want real recipe generation.',
    tags: ['local-placeholder'],
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(port, () => {
  console.log(`TB Gym API listening on http://127.0.0.1:${port}`);
});
