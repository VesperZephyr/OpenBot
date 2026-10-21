/** Research only: compare literal retrieval mechanics on synthetic bilingual notes. No OpenBot data or model calls. */
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');
const records = [
  ['english-drink', 'I avoid coffee after lunch.'],
  ['chinese-drink', '午后不喝咖啡，只喝茶。'],
  ['chinese-city', '用户现在住在香港。'],
  ['style', 'Use concise answers.'],
];
const queries = ['coffee', 'caffeine', '咖啡', '不喝咖啡', '香港', 'concise', 'short'];
try {
  db.exec("CREATE TABLE notes(id TEXT PRIMARY KEY, body TEXT); CREATE VIRTUAL TABLE words USING fts5(id UNINDEXED, body, tokenize='unicode61'); CREATE VIRTUAL TABLE triples USING fts5(id UNINDEXED, body, tokenize='trigram');");
  for (const record of records) for (const table of ['notes', 'words', 'triples']) db.prepare(`INSERT INTO ${table} (id,body) VALUES (?,?)`).run(...record);
  const ids = rows => rows.map(row => row.id).sort();
  const results = queries.map(query => ({query,
    unicode61: ids(db.prepare('SELECT id FROM words WHERE words MATCH ?').all('"'+query.replaceAll('"','""')+'"')),
    trigram: ids(db.prepare('SELECT id FROM triples WHERE triples MATCH ?').all('"'+query.replaceAll('"','""')+'"')),
    substring: ids(db.prepare('SELECT id FROM notes WHERE instr(lower(body),lower(?))>0').all(query)),
  }));
  console.log(JSON.stringify({node:process.version,sqlite:db.prepare('SELECT sqlite_version() AS version').get().version,records:records.length,results},null,2));
} finally { db.close(); }
