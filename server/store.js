import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const legacyDbPath = process.env.TB_GYM_DATA_FILE || path.join(dataDir, 'db.json');
const legacyMigrationMarker = path.join(dataDir, '.json-migrated-to-prisma');

const entityNames = [
  'AccessRequest',
  'CategoryPermission',
  'ChatMessage',
  'ClientInvitation',
  'ClientStrengthRecord',
  'ClientSubscription',
  'DayNote',
  'DietDayLog',
  'DietPlan',
  'Exercise',
  'ExerciseCategory',
  'Meal',
  'Notification',
  'ProgramCycle',
  'ProgramExercise',
  'ProgramStrengthProfile',
  'TrainingProgram',
  'WeightLog',
  'User',
];

const commonFields = ['id', 'created_date', 'updated_date', 'created_by'];

const entityFields = {
  AccessRequest: ['full_name', 'email', 'phone', 'message', 'status', 'reviewed_by', 'reviewed_at'],
  CategoryPermission: ['client_id', 'category_id', 'allowed'],
  ChatMessage: ['client_id', 'sender_role', 'sender_name', 'message', 'context'],
  ClientInvitation: [
    'full_name',
    'email',
    'phone',
    'date_of_birth',
    'height_cm',
    'weight_kg',
    'starting_weight_kg',
    'goal',
    'medical_conditions',
    'allergies',
    'program_name',
    'program_duration_weeks',
    'program_start_date',
    'program_end_date',
    'payment_due_date',
    'payment_status',
    'welcome_message',
    'status',
  ],
  ClientStrengthRecord: ['client_id', 'exercise_id', 'exercise_title', 'one_rm_kg', 'notes'],
  ClientSubscription: [
    'client_id',
    'client_name',
    'client_email',
    'start_date',
    'end_date',
    'duration_weeks',
    'total_fee',
    'amount_paid',
    'status',
    'payment_reminder_sent',
    'renewal_reminder_sent',
    'notes',
  ],
  DayNote: ['program_id', 'client_id', 'week', 'day', 'coach_note', 'client_note'],
  DietDayLog: ['client_id', 'diet_plan_id', 'date', 'meal_logs'],
  DietPlan: [
    'name',
    'assigned_client_id',
    'total_daily_calories',
    'total_daily_protein',
    'total_daily_carbs',
    'total_daily_fats',
    'meals',
  ],
  Exercise: ['title', 'category_id', 'video_url', 'description', 'thumbnail_url'],
  ExerciseCategory: ['name', 'icon'],
  Meal: [
    'name',
    'category',
    'custom_category',
    'calories',
    'protein',
    'carbs',
    'fats',
    'fiber',
    'sodium',
    'servings',
    'prep_time_minutes',
    'cook_time_minutes',
    'weight_mode',
    'ingredients',
    'preparation_steps',
    'cooking_tips',
    'image_url',
    'source_url',
    'tags',
  ],
  Notification: ['user_id', 'title', 'message', 'type', 'read'],
  ProgramCycle: [
    'client_id',
    'program_name',
    'start_date',
    'end_date',
    'duration_weeks',
    'payment_due_date',
    'payment_status',
    'status',
    'assigned_program_id',
    'notes',
    'payment_reminder_sent',
    'renewal_reminder_sent',
  ],
  ProgramExercise: [
    'program_id',
    'exercise_id',
    'exercise_title',
    'week',
    'day',
    'order',
    'sets',
    'reps',
    'rpe',
    'rir',
    'one_rm',
    'weight_lifted',
    'completed',
  ],
  ProgramStrengthProfile: ['program_id', 'client_id', 'exercise_id', 'exercise_title', 'one_rm_kg'],
  TrainingProgram: [
    'name',
    'description',
    'num_weeks',
    'num_days_per_week',
    'assigned_client_id',
    'admin_notes',
    'client_notes',
    'visibility_mode',
    'unlocked_weeks',
  ],
  WeightLog: ['client_id', 'date', 'weight_kg', 'note', 'body_fat_pct', 'waist_cm', 'chest_cm', 'hip_cm', 'steps'],
  User: [
    'full_name',
    'email',
    'role',
    'password_hash',
    'phone',
    'date_of_birth',
    'height_cm',
    'weight_kg',
    'starting_weight_kg',
    'target_weight_kg',
    'goal',
    'medical_conditions',
    'allergies',
    'payment_status',
    'payment_due_date',
    'program_start_date',
    'program_end_date',
    'account_start_date',
    'assigned_program_id',
    'assigned_diet_plan_id',
    'welcome_message',
    'is_blocked',
    'is_deleted',
    'deleted_at',
    'can_edit_weight_lifted',
    'can_edit_rpe',
    'can_edit_rir',
  ],
};

const jsonDefaults = {
  DietDayLog: { meal_logs: [] },
  DietPlan: { meals: [] },
  Meal: { ingredients: [], tags: [] },
  TrainingProgram: { unlocked_weeks: [] },
};

const fieldTypes = {
  allowed: 'boolean',
  amount_paid: 'number',
  body_fat_pct: 'number',
  calories: 'number',
  can_edit_rir: 'boolean',
  can_edit_rpe: 'boolean',
  can_edit_weight_lifted: 'boolean',
  carbs: 'number',
  chest_cm: 'number',
  completed: 'boolean',
  cook_time_minutes: 'int',
  created_date: 'datetime',
  duration_weeks: 'int',
  fats: 'number',
  fiber: 'number',
  height_cm: 'number',
  hip_cm: 'number',
  ingredients: 'json',
  is_blocked: 'boolean',
  is_deleted: 'boolean',
  meal_logs: 'json',
  meals: 'json',
  num_days_per_week: 'int',
  num_weeks: 'int',
  one_rm: 'number',
  one_rm_kg: 'number',
  order: 'int',
  payment_reminder_sent: 'boolean',
  prep_time_minutes: 'int',
  protein: 'number',
  read: 'boolean',
  renewal_reminder_sent: 'boolean',
  rir: 'number',
  rpe: 'number',
  servings: 'number',
  sets: 'int',
  sodium: 'number',
  starting_weight_kg: 'number',
  steps: 'int',
  tags: 'json',
  target_weight_kg: 'number',
  total_daily_calories: 'number',
  total_daily_carbs: 'number',
  total_daily_fats: 'number',
  total_daily_protein: 'number',
  total_fee: 'number',
  unlocked_weeks: 'json',
  updated_date: 'datetime',
  waist_cm: 'number',
  week: 'int',
  weight_kg: 'number',
  weight_lifted: 'number',
};

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function modelName(entity) {
  return `${entity[0].toLowerCase()}${entity.slice(1)}`;
}

function getDelegate(entity) {
  if (!entityNames.includes(entity)) {
    const error = new Error(`Unknown entity: ${entity}`);
    error.status = 404;
    throw error;
  }

  return prisma[modelName(entity)];
}

function knownFields(entity) {
  return new Set([...commonFields, ...(entityFields[entity] || [])]);
}

function coerceValue(key, value) {
  if (value === undefined) return undefined;

  const type = fieldTypes[key] || 'string';

  if (type === 'json') {
    if (value === null) return null;
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  if (type === 'datetime') {
    if (value === null || value === '') return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (type === 'number' || type === 'int') {
    if (value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return undefined;
    return type === 'int' ? Math.trunc(number) : number;
  }

  if (type === 'boolean') {
    if (value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return Boolean(value);
  }

  if (value === null) return null;
  return String(value);
}

function prepareData(entity, data = {}, { includeId = true } = {}) {
  const allowedFields = knownFields(entity);
  const prepared = {};

  for (const [key, value] of Object.entries(data || {})) {
    if (key === 'id' && !includeId) continue;
    if (!allowedFields.has(key)) continue;

    const coerced = coerceValue(key, value);
    if (coerced !== undefined) prepared[key] = coerced;
  }

  if (entity === 'User' && prepared.email) {
    prepared.email = normalizeEmail(prepared.email);
  }

  return prepared;
}

function prepareWhere(entity, criteria = {}) {
  const allowedFields = knownFields(entity);
  const where = {};

  for (const [key, expected] of Object.entries(criteria || {})) {
    if (expected === undefined) continue;
    if (!allowedFields.has(key)) return null;

    if (Array.isArray(expected)) {
      where[key] = { in: expected.map((item) => coerceValue(key, item)).filter((item) => item !== undefined) };
    } else {
      const coerced = coerceValue(key, expected);
      if (coerced !== undefined) where[key] = coerced;
    }
  }

  return where;
}

function parseSort(entity, sort) {
  if (!sort) return undefined;
  const desc = String(sort).startsWith('-');
  const key = desc ? String(sort).slice(1) : String(sort);

  if (!knownFields(entity).has(key)) return undefined;
  return { [key]: desc ? 'desc' : 'asc' };
}

function parseLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

function normalizeRecord(entity, record) {
  if (!record) return record;

  const normalized = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );

  for (const [key, fallback] of Object.entries(jsonDefaults[entity] || {})) {
    if (normalized[key] == null) {
      normalized[key] = fallback;
      continue;
    }

    if (typeof normalized[key] === 'string') {
      try {
        normalized[key] = JSON.parse(normalized[key]);
      } catch {
        normalized[key] = fallback;
      }
    }
  }

  return normalized;
}

function sanitizeUser(user) {
  if (!user) return user;
  const { password_hash, ...safe } = user;
  return safe;
}

function sanitize(entity, record) {
  if (Array.isArray(record)) return record.map((item) => sanitize(entity, item));
  const normalized = normalizeRecord(entity, record);
  if (entity === 'User') return sanitizeUser(normalized);
  return normalized;
}

function isMissingRecordError(error) {
  return error?.code === 'P2025';
}

async function importLegacyJsonData() {
  if (fs.existsSync(legacyMigrationMarker) || !fs.existsSync(legacyDbPath)) return;

  const parsed = JSON.parse(fs.readFileSync(legacyDbPath, 'utf8'));
  const collections = parsed.collections || {};

  for (const entity of entityNames) {
    const records = collections[entity] || [];
    const delegate = getDelegate(entity);

    for (const record of records) {
      const create = prepareData(entity, record);
      if (!create.id && entity !== 'User') continue;

      const { id, ...update } = create;
      if (entity === 'User' && create.email) {
        await delegate.upsert({
          where: { email: create.email },
          create,
          update,
        });
        continue;
      }

      await delegate.upsert({
        where: { id },
        create,
        update,
      });
    }
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(legacyMigrationMarker, new Date().toISOString(), 'utf8');
}

export const store = {
  async list(entity, { sort, limit } = {}) {
    const delegate = getDelegate(entity);
    const rows = await delegate.findMany({
      orderBy: parseSort(entity, sort),
      take: parseLimit(limit),
    });
    return sanitize(entity, rows);
  },

  async filter(entity, criteria = {}, { sort, limit } = {}) {
    const delegate = getDelegate(entity);
    const where = prepareWhere(entity, criteria);
    if (where === null) return [];

    const rows = await delegate.findMany({
      where,
      orderBy: parseSort(entity, sort),
      take: parseLimit(limit),
    });
    return sanitize(entity, rows);
  },

  async findById(entity, id) {
    const delegate = getDelegate(entity);
    const record = await delegate.findUnique({ where: { id: String(id) } });
    return sanitize(entity, record || null);
  },

  async rawFind(entity, criteria = {}) {
    const delegate = getDelegate(entity);
    const where = prepareWhere(entity, criteria);
    if (where === null) return null;
    return delegate.findFirst({ where });
  },

  async create(entity, data = {}, actor) {
    const delegate = getDelegate(entity);
    const actorId = actor?.email || actor?.id || 'local';
    const record = await delegate.create({
      data: prepareData(entity, {
        ...data,
        created_by: data.created_by || actorId,
      }),
    });
    return sanitize(entity, record);
  },

  async update(entity, id, patch = {}) {
    const delegate = getDelegate(entity);

    try {
      const record = await delegate.update({
        where: { id: String(id) },
        data: prepareData(entity, patch, { includeId: false }),
      });
      return sanitize(entity, record);
    } catch (error) {
      if (isMissingRecordError(error)) return null;
      throw error;
    }
  },

  async delete(entity, id) {
    const delegate = getDelegate(entity);

    try {
      await delegate.delete({ where: { id: String(id) } });
      return true;
    } catch (error) {
      if (isMissingRecordError(error)) return false;
      throw error;
    }
  },

  normalizeEmail,
};

export async function seedDatabase() {
  await importLegacyJsonData();

  const adminEmail = normalizeEmail(process.env.SEED_ADMIN_EMAIL || 'admin@gym.local');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const adminExists = await store.rawFind('User', { email: adminEmail });

  if (!adminExists) {
    await store.create('User', {
      full_name: 'Local Admin',
      email: adminEmail,
      role: 'admin',
      password_hash: await bcrypt.hash(adminPassword, 12),
      payment_status: 'paid',
      is_blocked: false,
    });
  }

  const categories = await store.list('ExerciseCategory');
  if (categories.length === 0) {
    await Promise.all(
      ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 'Cardio'].map((name) => (
        store.create('ExerciseCategory', { name, icon: 'Dumbbell' })
      )),
    );
  }
}
