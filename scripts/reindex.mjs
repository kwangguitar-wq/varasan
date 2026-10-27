/**
 * Rebuild keyword indexes from each publication's stored content text.
 * Run after changing the tokenizer or stopword list: node scripts/reindex.mjs
 */
import { db } from '../server/db.js';
import { buildKeywordIndex, saveKeywords } from '../server/indexer.js';

const rows = db.prepare('SELECT id, title, author, content_text FROM publications ORDER BY id').all();
db.exec('BEGIN');
try {
  for (const row of rows) {
    const text = String(row.content_text ?? '').trim() || row.title;
    const keywords = buildKeywordIndex(text, { title: row.title, author: row.author ?? '' });
    saveKeywords(row.id, keywords);
    db.prepare('UPDATE publications SET top_keywords = ? WHERE id = ?').run(
      JSON.stringify(keywords.slice(0, 14).map(({ term, count }) => ({ term, count }))),
      row.id,
    );
    console.log(`${row.id} ${row.title.slice(0, 40)} → ${keywords.slice(0, 6).map((k) => k.term).join(', ')}`);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
console.log(`reindexed ${rows.length} publications`);
