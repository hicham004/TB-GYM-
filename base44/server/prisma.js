import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const databaseUrl = process.env.DATABASE_URL || 'file:./data/tb-gym-dev.db';
const adapter = new PrismaLibSql({ url: databaseUrl });

export const prisma = new PrismaClient({
  adapter,
  log: process.env.PRISMA_LOG_QUERIES === 'true'
    ? ['query', 'warn', 'error']
    : ['warn', 'error'],
});
