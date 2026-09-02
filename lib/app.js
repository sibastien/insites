'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { db, ready, CRITERIA } = require('./db');

function parseJsonOrNull(v) {
  if (v === null || v === undefined) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

async function rowToActivity(row) {
  const hist = await db.execute({
    sql: 'SELECT * FROM audit_history WHERE activityId = ? ORDER BY id DESC',
    args: [row.id],
  });
  const auditHistory = hist.rows.map(h => ({
    id: Number(h.id),
    date: h.date,
    total: h.total,
    scores: parseJsonOrNull(h.scores) || {},
    scoresNotes: parseJsonOrNull(h.scoresNotes) || {},
    scoresActions: parseJsonOrNull(h.scoresActions) || {},
    auditOverview: h.auditOverview || '',
    auditAiInsight: h.auditAiInsight || '',
  }));
  return {
    id: row.id,
    nom: row.nom,
    marque: row.marque,
    plateforme: row.plateforme,
    depart: row.depart,
    duree: row.duree,
    tripLink: row.tripLink,
    note: row.note,
    avisCount: row.avisCount,
    total: row.total,
    lastAudit: row.lastAudit,
    nextAudit: row.nextAudit,
    scores: parseJsonOrNull(row.scores) || {},
    scoresNotes: parseJsonOrNull(row.scoresNotes) || {},
    scoresActions: parseJsonOrNull(row.scoresActions) || {},
    auditOverview: row.auditOverview || '',
    auditAiInsight: row.auditAiInsight || '',
    auditDraft: !!row.auditDraft,
    auditHistory,
  };
}

async function getActivityRow(id) {
  const { rows } = await db.execute({ sql: 'SELECT * FROM activities WHERE id = ?', args: [id] });
  return rows[0] || null;
}

async function buildState() {
  const actRows = (await db.execute('SELECT * FROM activities')).rows;
  const activities = await Promise.all(actRows.map(rowToActivity));
  const reviews = (await db.execute('SELECT * FROM reviews')).rows;
  const competitors = (await db.execute('SELECT * FROM competitors')).rows;
  const dailyRows = (await db.execute('SELECT * FROM daily_logs')).rows;
  const dailyLogs = dailyRows.map(d => ({
    date: d.date,
    tasks: parseJsonOrNull(d.tasks) || {},
    measures: parseJsonOrNull(d.measures) || {},
    notes: d.notes || '',
  }));
  return { activities, reviews, competitors, dailyLogs };
}

function clampScores(input) {
  const scores = {}, notes = {}, actions = {};
  let total = 0;
  CRITERIA.forEach(c => {
    let v = input.scores ? input.scores[c.key] : null;
    if (v === '' || v === undefined) v = null;
    if (v !== null) {
      v = Number(v);
      if (!Number.isFinite(v)) v = 0;
      v = Math.max(0, Math.min(c.max, v));
    }
    scores[c.key] = v;
    total += v || 0;
    notes[c.key] = ((input.scoresNotes && input.scoresNotes[c.key]) || '').toString();
    actions[c.key] = ((input.scoresActions && input.scoresActions[c.key]) || '').toString();
  });
  return { scores, notes, actions, total };
}

function wrap(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur serveur.' });
  });
}

function basicAuth(req, res, next) {
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) {
    res.status(500).send('APP_PASSWORD n\'est pas configuré sur le serveur.');
    return;
  }
  const expectedUser = process.env.APP_USERNAME || 'souhaib';
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  let ok = false;
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    const userBuf = Buffer.from(user || '');
    const expUserBuf = Buffer.from(expectedUser);
    const passBuf = Buffer.from(pass || '');
    const expPassBuf = Buffer.from(expectedPassword);
    const userOk = userBuf.length === expUserBuf.length && crypto.timingSafeEqual(userBuf, expUserBuf);
    const passOk = passBuf.length === expPassBuf.length && crypto.timingSafeEqual(passBuf, expPassBuf);
    ok = userOk && passOk;
  }
  if (!ok) {
    res.set('WWW-Authenticate', 'Basic realm="Dashboard Souhaib"');
    res.status(401).send('Authentification requise.');
    return;
  }
  next();
}

const app = express();
app.use(basicAuth);
app.use(express.json());
app.use(async (req, res, next) => {
  try { await ready(); next(); }
  catch (err) { res.status(500).json({ error: 'Base de données indisponible : ' + err.message }); }
});
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------- STATE ---------- */
app.get('/api/state', wrap(async (req, res) => {
  res.json(await buildState());
}));

/* ---------- ACTIVITIES ---------- */
app.post('/api/activities', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.nom || !b.nom.trim()) return res.status(400).json({ error: "Le nom de l'activité est obligatoire." });
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO activities (id, nom, marque, plateforme, depart, duree, tripLink, note, avisCount, total, lastAudit, nextAudit, scores, scoresNotes, scoresActions, auditOverview, auditAiInsight, auditDraft)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0)`,
    args: [id, b.nom.trim(), b.marque || '', b.plateforme || '', b.depart || '', b.duree || '', b.tripLink || null,
      b.note != null ? Number(b.note) : null, b.avisCount != null ? Number(b.avisCount) : null],
  });
  res.status(201).json(await rowToActivity(await getActivityRow(id)));
}));

app.put('/api/activities/:id', wrap(async (req, res) => {
  const row = await getActivityRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activité introuvable.' });
  const b = req.body || {};
  if (!b.nom || !b.nom.trim()) return res.status(400).json({ error: "Le nom de l'activité est obligatoire." });
  await db.execute({
    sql: `UPDATE activities SET nom=?, marque=?, plateforme=?, depart=?, duree=?, tripLink=?, note=?, avisCount=? WHERE id=?`,
    args: [b.nom.trim(), b.marque || '', b.plateforme || '', b.depart || '', b.duree || '', b.tripLink || null,
      b.note != null ? Number(b.note) : null, b.avisCount != null ? Number(b.avisCount) : null, req.params.id],
  });
  res.json(await rowToActivity(await getActivityRow(req.params.id)));
}));

app.delete('/api/activities/:id', wrap(async (req, res) => {
  const row = await getActivityRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activité introuvable.' });
  await db.execute({ sql: 'DELETE FROM audit_history WHERE activityId = ?', args: [req.params.id] });
  await db.execute({ sql: 'DELETE FROM activities WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
}));

app.post('/api/activities/:id/audit', wrap(async (req, res) => {
  const row = await getActivityRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activité introuvable.' });
  const b = req.body || {};
  const { scores, notes, actions, total } = clampScores(b);
  const nextAudit = b.nextAudit || null;
  const overview = (b.auditOverview || '').toString();
  const aiInsight = (b.auditAiInsight || '').toString();

  if (b.draft) {
    await db.execute({
      sql: `UPDATE activities SET scores=?, scoresNotes=?, scoresActions=?, auditOverview=?, auditAiInsight=?, nextAudit=?, auditDraft=1 WHERE id=?`,
      args: [JSON.stringify(scores), JSON.stringify(notes), JSON.stringify(actions), overview, aiInsight, nextAudit, req.params.id],
    });
  } else {
    const today = new Date().toISOString().slice(0, 10);
    await db.batch([
      {
        sql: `INSERT INTO audit_history (activityId, date, total, scores, scoresNotes, scoresActions, auditOverview, auditAiInsight) VALUES (?,?,?,?,?,?,?,?)`,
        args: [req.params.id, today, total, JSON.stringify(scores), JSON.stringify(notes), JSON.stringify(actions), overview, aiInsight],
      },
      {
        sql: `UPDATE activities SET scores=?, scoresNotes=?, scoresActions=?, total=?, lastAudit=?, nextAudit=?, auditOverview=?, auditAiInsight=?, auditDraft=0 WHERE id=?`,
        args: [JSON.stringify(scores), JSON.stringify(notes), JSON.stringify(actions), total, today, nextAudit, overview, aiInsight, req.params.id],
      },
    ], 'write');
  }
  res.json(await rowToActivity(await getActivityRow(req.params.id)));
}));

app.delete('/api/activities/:id/audit-history/:histId', wrap(async (req, res) => {
  const row = await getActivityRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activité introuvable.' });
  await db.execute({ sql: 'DELETE FROM audit_history WHERE id = ? AND activityId = ?', args: [Number(req.params.histId), req.params.id] });
  const remaining = (await db.execute({ sql: 'SELECT * FROM audit_history WHERE activityId = ? ORDER BY id DESC', args: [req.params.id] })).rows;
  if (remaining.length) {
    const latest = remaining[0];
    await db.execute({
      sql: `UPDATE activities SET scores=?, scoresNotes=?, scoresActions=?, total=?, lastAudit=?, auditOverview=?, auditAiInsight=?, auditDraft=0 WHERE id=?`,
      args: [latest.scores, latest.scoresNotes, latest.scoresActions, latest.total, latest.date, latest.auditOverview, latest.auditAiInsight, req.params.id],
    });
  } else {
    await db.execute({
      sql: `UPDATE activities SET scores=NULL, scoresNotes=NULL, scoresActions=NULL, total=NULL, lastAudit=NULL, auditOverview=NULL, auditAiInsight=NULL, auditDraft=0 WHERE id=?`,
      args: [req.params.id],
    });
  }
  res.json(await rowToActivity(await getActivityRow(req.params.id)));
}));

/* ---------- REVIEWS ---------- */
app.post('/api/reviews', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.activityId) return res.status(400).json({ error: 'Activité requise.' });
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO reviews (id, activityId, plateforme, date, categorie, sentiment, texte) VALUES (?,?,?,?,?,?,?)`,
    args: [id, b.activityId, b.plateforme || '', b.date || new Date().toISOString().slice(0, 10), b.categorie || '', b.sentiment || '', b.texte || ''],
  });
  res.status(201).json((await db.execute({ sql: 'SELECT * FROM reviews WHERE id = ?', args: [id] })).rows[0]);
}));
app.put('/api/reviews/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const exists = (await db.execute({ sql: 'SELECT id FROM reviews WHERE id = ?', args: [req.params.id] })).rows[0];
  if (!exists) return res.status(404).json({ error: 'Avis introuvable.' });
  await db.execute({
    sql: `UPDATE reviews SET activityId=?, plateforme=?, date=?, categorie=?, sentiment=?, texte=? WHERE id=?`,
    args: [b.activityId, b.plateforme || '', b.date || '', b.categorie || '', b.sentiment || '', b.texte || '', req.params.id],
  });
  res.json((await db.execute({ sql: 'SELECT * FROM reviews WHERE id = ?', args: [req.params.id] })).rows[0]);
}));
app.delete('/api/reviews/:id', wrap(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM reviews WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
}));

/* ---------- COMPETITORS ---------- */
app.post('/api/competitors', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.nom || !b.nom.trim()) return res.status(400).json({ error: 'Le nom du concurrent est obligatoire.' });
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO competitors (id, plateforme, date, nom, prix, activityId, forces, ecarts) VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, b.plateforme || '', b.date || new Date().toISOString().slice(0, 10), b.nom.trim(), b.prix || '', b.activityId || null, b.forces || '', b.ecarts || ''],
  });
  res.status(201).json((await db.execute({ sql: 'SELECT * FROM competitors WHERE id = ?', args: [id] })).rows[0]);
}));
app.put('/api/competitors/:id', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.nom || !b.nom.trim()) return res.status(400).json({ error: 'Le nom du concurrent est obligatoire.' });
  const exists = (await db.execute({ sql: 'SELECT id FROM competitors WHERE id = ?', args: [req.params.id] })).rows[0];
  if (!exists) return res.status(404).json({ error: 'Fiche introuvable.' });
  await db.execute({
    sql: `UPDATE competitors SET plateforme=?, date=?, nom=?, prix=?, activityId=?, forces=?, ecarts=? WHERE id=?`,
    args: [b.plateforme || '', b.date || '', b.nom.trim(), b.prix || '', b.activityId || null, b.forces || '', b.ecarts || '', req.params.id],
  });
  res.json((await db.execute({ sql: 'SELECT * FROM competitors WHERE id = ?', args: [req.params.id] })).rows[0]);
}));
app.delete('/api/competitors/:id', wrap(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM competitors WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
}));

/* ---------- DAILY LOGS ---------- */
app.put('/api/daily/:date', wrap(async (req, res) => {
  const b = req.body || {};
  const date = req.params.date;
  const tasks = JSON.stringify(b.tasks || {});
  const measures = JSON.stringify(b.measures || {});
  const notes = b.notes || '';
  const exists = (await db.execute({ sql: 'SELECT date FROM daily_logs WHERE date = ?', args: [date] })).rows[0];
  if (exists) {
    await db.execute({ sql: 'UPDATE daily_logs SET tasks=?, measures=?, notes=? WHERE date=?', args: [tasks, measures, notes, date] });
  } else {
    await db.execute({ sql: 'INSERT INTO daily_logs (date, tasks, measures, notes) VALUES (?,?,?,?)', args: [date, tasks, measures, notes] });
  }
  const row = (await db.execute({ sql: 'SELECT * FROM daily_logs WHERE date = ?', args: [date] })).rows[0];
  res.json({ date: row.date, tasks: parseJsonOrNull(row.tasks) || {}, measures: parseJsonOrNull(row.measures) || {}, notes: row.notes || '' });
}));
app.delete('/api/daily/:date', wrap(async (req, res) => {
  await db.execute({ sql: 'DELETE FROM daily_logs WHERE date = ?', args: [req.params.date] });
  res.status(204).end();
}));

/* ---------- BACKUP ---------- */
app.get('/api/backup', wrap(async (req, res) => {
  res.json(await buildState());
}));

app.post('/api/backup/import', wrap(async (req, res) => {
  const s = req.body || {};
  if (!Array.isArray(s.activities)) return res.status(400).json({ error: 'Format de sauvegarde invalide.' });

  const statements = [
    { sql: 'DELETE FROM audit_history', args: [] },
    { sql: 'DELETE FROM activities', args: [] },
    { sql: 'DELETE FROM reviews', args: [] },
    { sql: 'DELETE FROM competitors', args: [] },
    { sql: 'DELETE FROM daily_logs', args: [] },
  ];

  const insertActSql = `INSERT INTO activities (id, nom, marque, plateforme, depart, duree, tripLink, note, avisCount, total, lastAudit, nextAudit, scores, scoresNotes, scoresActions, auditOverview, auditAiInsight, auditDraft)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const insertHistSql = `INSERT INTO audit_history (activityId, date, total, scores, scoresNotes, scoresActions, auditOverview, auditAiInsight) VALUES (?,?,?,?,?,?,?,?)`;

  (s.activities || []).forEach(a => {
    const id = a.id || crypto.randomUUID();
    statements.push({
      sql: insertActSql,
      args: [id, a.nom || '', a.marque || '', a.plateforme || '', a.depart || '', a.duree || '', a.tripLink || null,
        a.note != null ? Number(a.note) : null, a.avisCount != null ? Number(a.avisCount) : null,
        a.total != null ? Number(a.total) : null, a.lastAudit || null, a.nextAudit || null,
        a.scores ? JSON.stringify(a.scores) : null, a.scoresNotes ? JSON.stringify(a.scoresNotes) : null,
        a.scoresActions ? JSON.stringify(a.scoresActions) : null, a.auditOverview || null, a.auditAiInsight || null,
        a.auditDraft ? 1 : 0],
    });
    (a.auditHistory || []).slice().reverse().forEach(h => {
      statements.push({
        sql: insertHistSql,
        args: [id, h.date || null, h.total != null ? Number(h.total) : null,
          h.scores ? JSON.stringify(h.scores) : null, h.scoresNotes ? JSON.stringify(h.scoresNotes) : null,
          h.scoresActions ? JSON.stringify(h.scoresActions) : null, h.auditOverview || null, h.auditAiInsight || null],
      });
    });
  });

  const insertRevSql = `INSERT INTO reviews (id, activityId, plateforme, date, categorie, sentiment, texte) VALUES (?,?,?,?,?,?,?)`;
  (s.reviews || []).forEach(r => {
    statements.push({ sql: insertRevSql, args: [r.id || crypto.randomUUID(), r.activityId || null, r.plateforme || '', r.date || '', r.categorie || '', r.sentiment || '', r.texte || ''] });
  });

  const insertCompSql = `INSERT INTO competitors (id, plateforme, date, nom, prix, activityId, forces, ecarts) VALUES (?,?,?,?,?,?,?,?)`;
  (s.competitors || []).forEach(c => {
    statements.push({ sql: insertCompSql, args: [c.id || crypto.randomUUID(), c.plateforme || '', c.date || '', c.nom || '', c.prix || '', c.activityId || null, c.forces || '', c.ecarts || ''] });
  });

  const insertDailySql = `INSERT INTO daily_logs (date, tasks, measures, notes) VALUES (?,?,?,?)`;
  (s.dailyLogs || []).forEach(d => {
    statements.push({ sql: insertDailySql, args: [d.date, JSON.stringify(d.tasks || {}), JSON.stringify(d.measures || {}), d.notes || ''] });
  });

  try {
    await db.batch(statements, 'write');
  } catch (e) {
    return res.status(500).json({ error: 'Import échoué : ' + e.message });
  }
  res.json(await buildState());
}));

module.exports = app;
