'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createClient } = require('@libsql/client');

// Locally (no env vars set) this falls back to a SQLite file on disk, so
// `npm start` works with zero setup. On Vercel, set TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN (from a Turso database) so the data survives across
// serverless invocations and deploys — a local file would not.
let url = process.env.TURSO_DATABASE_URL;
let authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) {
  const dataDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  url = 'file:' + path.join(dataDir, 'dashboard.db');
}

const db = createClient({ url, authToken });

const CRITERIA = [
  { key: 'titre', max: 10 },
  { key: 'photo', max: 15 },
  { key: 'galerie', max: 10 },
  { key: 'description', max: 10 },
  { key: 'programme', max: 15 },
  { key: 'clarte', max: 10 },
  { key: 'diff', max: 10 },
  { key: 'avis', max: 10 },
  { key: 'prix', max: 10 },
];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    marque TEXT,
    plateforme TEXT,
    depart TEXT,
    duree TEXT,
    tripLink TEXT,
    note REAL,
    avisCount INTEGER,
    total INTEGER,
    lastAudit TEXT,
    nextAudit TEXT,
    scores TEXT,
    scoresNotes TEXT,
    scoresActions TEXT,
    auditOverview TEXT,
    auditAiInsight TEXT,
    auditDraft INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS audit_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activityId TEXT NOT NULL,
    date TEXT,
    total INTEGER,
    scores TEXT,
    scoresNotes TEXT,
    scoresActions TEXT,
    auditOverview TEXT,
    auditAiInsight TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    activityId TEXT,
    plateforme TEXT,
    date TEXT,
    categorie TEXT,
    sentiment TEXT,
    texte TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS competitors (
    id TEXT PRIMARY KEY,
    plateforme TEXT,
    date TEXT,
    nom TEXT,
    prix TEXT,
    activityId TEXT,
    forces TEXT,
    ecarts TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS daily_logs (
    date TEXT PRIMARY KEY,
    tasks TEXT,
    measures TEXT,
    notes TEXT
  )`,
];

let readyPromise = null;

async function seedIfEmpty() {
  const { rows } = await db.execute('SELECT COUNT(*) AS n FROM activities');
  if (Number(rows[0].n) > 0) return;
  const insert = `INSERT INTO activities
      (id, nom, marque, plateforme, depart, duree, tripLink, note, avisCount, total, lastAudit, nextAudit, scores, scoresNotes, scoresActions, auditOverview, auditAiInsight, auditDraft)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0)`;
  await db.batch([
    { sql: insert, args: [crypto.randomUUID(), '2-Day Mountain Oases (exemple)', 'Dunes Insolites', 'GetYourGuide', 'Marrakech', '2 jours', 4.8, 62] },
    { sql: insert, args: [crypto.randomUUID(), 'Circuit Désert & Oasis (exemple)', 'Route Insolite', 'GetYourGuide', 'Marrakech', '3 jours', null, null] },
  ], 'write');
}

function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      for (const stmt of SCHEMA) await db.execute(stmt);
      await seedIfEmpty();
    })().catch(err => { readyPromise = null; throw err; });
  }
  return readyPromise;
}

module.exports = { db, ready, CRITERIA };
