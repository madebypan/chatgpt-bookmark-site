import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildFtsMatchQuery } from "../lib/fts.ts";

const migrationUrl = new URL("../drizzle/0007_kind_roland_deschain.sql", import.meta.url);

function createFtsDatabase(migration) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE bookmark_chunks (
      id TEXT PRIMARY KEY NOT NULL,
      bookmark_id TEXT NOT NULL,
      revision TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      title TEXT DEFAULT '' NOT NULL,
      site_name TEXT DEFAULT '' NOT NULL,
      author TEXT DEFAULT '' NOT NULL,
      heading TEXT DEFAULT '' NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO bookmark_chunks
      (id, bookmark_id, revision, ordinal, title, site_name, author, heading, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "existing:0",
    "existing",
    "rev-1",
    0,
    "廣告策略手冊",
    "Example",
    "Pan",
    "受眾研究",
    "先理解使用者的需求，再設計廣告訊息。",
  );

  const ftsStart = migration.indexOf("CREATE VIRTUAL TABLE `bookmark_chunks_fts`");
  assert.notEqual(ftsStart, -1, "the migration must contain the FTS definition");
  db.exec(migration.slice(ftsStart).replaceAll("--> statement-breakpoint", ""));
  return db;
}

function matchedIds(db, query) {
  return db.prepare(`
    SELECT chunks.id
    FROM bookmark_chunks_fts
    INNER JOIN bookmark_chunks AS chunks
      ON chunks.rowid = bookmark_chunks_fts.rowid
    WHERE bookmark_chunks_fts MATCH ?
    ORDER BY -bm25(bookmark_chunks_fts, 12.0, 4.0, 3.0, 6.0, 1.0) DESC
  `).all(query).map((row) => row.id);
}

test("FTS migration rebuilds pre-existing chunks and supports Chinese trigram search", async (t) => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = createFtsDatabase(migration);
  t.after(() => db.close());

  assert.deepEqual(matchedIds(db, '"廣告策略"'), ["existing:0"]);
  assert.deepEqual(matchedIds(db, '"使用者"'), ["existing:0"]);
});

test("FTS insert, update, and delete triggers keep the external-content index synchronized", async (t) => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = createFtsDatabase(migration);
  t.after(() => db.close());
  const insert = db.prepare(`
    INSERT INTO bookmark_chunks
      (id, bookmark_id, revision, ordinal, title, site_name, author, heading, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    "new:0",
    "new",
    "rev-1",
    0,
    "Retrieval Notes",
    "Knowledge Lab",
    "Ada",
    "Hybrid search",
    "Semantic retrieval complements exact keyword search.",
  );
  assert.deepEqual(matchedIds(db, '"semantic retrieval"'), ["new:0"]);

  db.prepare("UPDATE bookmark_chunks SET content = ? WHERE id = ?")
    .run("Grounded answers require reliable citations.", "new:0");
  assert.deepEqual(matchedIds(db, '"semantic retrieval"'), []);
  assert.deepEqual(matchedIds(db, '"reliable citations"'), ["new:0"]);

  db.prepare("DELETE FROM bookmark_chunks WHERE id = ?").run("new:0");
  assert.deepEqual(matchedIds(db, '"reliable citations"'), []);
});

test("FTS query gives title matches more weight than body-only matches", async (t) => {
  const migration = await readFile(migrationUrl, "utf8");
  const db = createFtsDatabase(migration);
  t.after(() => db.close());
  const insert = db.prepare(`
    INSERT INTO bookmark_chunks
      (id, bookmark_id, revision, ordinal, title, site_name, author, heading, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    "title-match:0",
    "title-match",
    "rev-1",
    0,
    "RAG evaluation guide",
    "",
    "",
    "Overview",
    "A practical checklist for comparing systems.",
  );
  insert.run(
    "body-match:0",
    "body-match",
    "rev-1",
    0,
    "Evaluation guide",
    "",
    "",
    "Overview",
    "This note briefly mentions RAG evaluation among many unrelated details.",
  );

  const rows = db.prepare(`
    SELECT chunks.id,
      -bm25(bookmark_chunks_fts, 12.0, 4.0, 3.0, 6.0, 1.0) AS score
    FROM bookmark_chunks_fts
    INNER JOIN bookmark_chunks AS chunks
      ON chunks.rowid = bookmark_chunks_fts.rowid
    WHERE bookmark_chunks_fts MATCH ?
    ORDER BY score DESC
  `).all('"rag evaluation"');

  assert.deepEqual(rows.map((row) => row.id), ["title-match:0", "body-match:0"]);
  assert.ok(rows[0].score > rows[1].score);
});

test("MATCH query builder quotes terms, removes controls, and bounds query expansion", () => {
  assert.equal(
    buildFtsMatchQuery("RAG evaluation"),
    '"rag evaluation" OR "rag" OR "evaluation"',
  );
  assert.equal(
    buildFtsMatchQuery('RAG" OR * NEAR(attack)\u0000'),
    '"rag or * near(attack)" OR "rag" OR "near(attack)"',
  );
  assert.equal(buildFtsMatchQuery("AI"), null);
  assert.equal(buildFtsMatchQuery("\u0000 \n \t"), null);
  assert.equal(
    buildFtsMatchQuery("alpha beta gamma delta", 2),
    '"alpha beta gamma delta" OR "alpha"',
  );
});
