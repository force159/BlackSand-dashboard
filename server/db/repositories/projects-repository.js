'use strict';
/**
 * Projects repository — parameterized SQLite access only. No frontend parsing, no
 * Monday logic, no KPI calculation. Every method takes the open `db` handle so it
 * composes inside a seed transaction on the same connection.
 *
 * Identity: the `slug` UNIQUE constraint (projects are NEVER identified by display
 * name). Seed rows are written with source = 'seed'.
 */

/** Upsert a seed project by slug. Returns the project id. Preserves created_at. */
function upsertSeedProject(db, data, now) {
  const row = db
    .prepare(
      `INSERT INTO projects (external_id, slug, name, address, is_active, source, source_updated_at, created_at, updated_at)
       VALUES (@external_id, @slug, @name, @address, 1, 'seed', @source_updated_at, @now, @now)
       ON CONFLICT(slug) DO UPDATE SET
         name = excluded.name,
         address = excluded.address,
         is_active = 1,
         source = 'seed',
         source_updated_at = excluded.source_updated_at,
         updated_at = excluded.updated_at
       RETURNING id`
    )
    .get({
      external_id: data.externalId ?? null,
      slug: data.slug,
      name: data.name,
      address: data.address ?? null,
      source_updated_at: data.sourceUpdatedAt ?? null,
      now,
    });
  return row.id;
}

function findProjectBySlug(db, slug) {
  return db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug);
}

function listProjects(db) {
  return db.prepare('SELECT * FROM projects ORDER BY slug ASC').all();
}

function countProjects(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM projects').get().n;
}

/**
 * Delete seed projects whose slug is no longer present in the seed set. Scoped to
 * source = 'seed' so Monday-sourced projects are never touched. Children are removed
 * by ON DELETE CASCADE.
 */
function deleteObsoleteSeedProjects(db, activeSlugs) {
  const all = db.prepare("SELECT id, slug FROM projects WHERE source = 'seed'").all();
  const keep = new Set(activeSlugs);
  const del = db.prepare('DELETE FROM projects WHERE id = ?');
  let removed = 0;
  for (const p of all) {
    if (!keep.has(p.slug)) { del.run(p.id); removed++; }
  }
  return removed;
}

module.exports = {
  upsertSeedProject,
  findProjectBySlug,
  listProjects,
  countProjects,
  deleteObsoleteSeedProjects,
};
