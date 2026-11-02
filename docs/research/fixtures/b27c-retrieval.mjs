/** Synthetic design spike, not an implementation of OpenBot authority or persistence. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const note = (id, heading, content, scope = 'bot', placement = 'on-demand', status = 'active') =>
  ({ id, heading, content, scope, placement, status, key: heading.normalize('NFKC').trim().toLowerCase() });
export const notes = [
  note('style', 'Answer style', 'Use concise answers. State uncertainty instead of inventing personal facts.', 'bot', 'always'),
  note('language', '回复语言', '默认跟随提问语言回复。金额保留原币种。', 'shared', 'always'),
  note('coffee', 'Afternoon drinks', 'I avoid coffee after lunch. Offer rooibos instead; tea with caffeine is also unsuitable.'),
  note('city', '居住城市', '用户现在住在香港。出差目的地不代表居住地。'),
  note('collection', 'Collection policy', 'Current rule: include unpaid invoices only when days_overdue is strictly greater than 20. Currency USD. Paid invoices are excluded.'),
  note('budget', '差旅预算', '当前每晚酒店预算上限为人民币 680 元。含税，不含早餐。'),
  note('project', 'Project A-17', 'The A-17 dry-run is on 18 November. The owner review happens on 21 November.'),
  note('unicode', 'ＡＢＣ workspace', 'Use the full-width label ＡＢＣ only in the display title. The export label is ABC.'),
  note('accent', 'Café meeting', 'Meet at Café Ardoise at 09:30. This is a synthetic venue.'),
  note('spacing', 'Report format', 'Use concise\n\t weekly summaries with a source table.'),
  note('address-local', 'Delivery address', 'Old local destination: Warehouse Cedar.', 'bot'),
  note('address-shared', 'Delivery address', 'Current delivery destination: Warehouse Maple.', 'shared'),
  note('retired-local', 'Retired project', 'Old project alias: LANTERN-61.', 'bot'),
  note('retired-shared', 'Retired project', '', 'shared', 'on-demand', 'forgotten'),
  note('moved', 'Moved topic', 'MOVED-SECRET', 'shared', 'on-demand', 'shared'),
  note('long', 'Archive labels', 'The following labels apply only to the synthetic paper archive. '.repeat(36) + 'The final cabinet code is IRIS-93.'),
  ...Array.from({ length: 12 }, (_, i) => note(`ops-${i}`, `Workshop ${i + 1} logistics`,
    `Workshop ${i + 1} uses room ${i + 11} in the training building. Prepare a whiteboard, four markers, printed worksheets and a sign-in sheet. Return reusable supplies to the storage shelf. Label the attendance export with the workshop number. These arrangements concern this workshop only.`, i < 8 ? 'bot' : 'shared')),
];
export const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
export function eligible(records = notes, group = false) {
  const blocked = new Set(group ? [] : records.filter(n => n.scope === 'shared' && n.status !== 'shared').map(n => n.key));
  return records.filter(n => n.status === 'active' && (n.scope === 'shared' ? !group : !blocked.has(n.key)));
}
export function matches(query, records = eligible()) {
  assert(typeof query === 'string' && [...query].length <= 256 && normalize(query));
  const q = normalize(query);
  return records.map(n => ({ n, rank: normalize(n.heading) === q ? 0 : normalize(n.heading).includes(q) ? 1 : normalize(n.content).includes(q) ? 2 : 3 }))
    .filter(x => x.rank < 3).sort((a, b) => a.rank - b.rank || (a.n.scope < b.n.scope ? -1 : a.n.scope > b.n.scope ? 1 : a.n.id < b.n.id ? -1 : a.n.id > b.n.id ? 1 : 0)).map(x => x.n);
}
const revisions = { local: 7, shared: 4 };
export const reference = n => ({ version: 1, botId: 'bot_fixture', conversationId: 'conversation_fixture', scope: n.scope, noteId: n.id, revisions });
export function search(query, records = eligible()) {
  const all = matches(query, records), result = { ok: true, revisions, observedAt: 1793491200000, hits: [], truncated: false };
  for (const n of all.slice(0, 5)) {
    const chars = [...n.content];
    const hit = { ref: reference(n), heading: n.heading, snippet: chars.slice(0, 256).join(''), partial: chars.length > 256, source: { kind: 'user', at: 1793404800000 } };
    result.hits.push(hit);
    if (bytes(JSON.stringify(result)) > 4096) { result.hits.pop(); break; }
  }
  result.truncated = result.hits.length < all.length;
  return result;
}
export function read(ref, offset = 0, records = eligible()) {
  assert(Number.isSafeInteger(offset) && offset >= 0);
  const n = records.find(n => isDeepStrictEqual(reference(n), ref));
  if (!n) return { ok: false, error: 'unavailable' };
  const chars = [...n.content];
  if (offset > chars.length) return { ok: false, error: 'invalid_arguments' };
  let end = offset;
  while (end < chars.length && bytes(chars.slice(offset, end + 1).join('')) <= 2048) end++;
  const result = () => ({ ok: true, ref, observedAt: 1793491200000, text: chars.slice(offset, end).join(''), complete: end === chars.length, nextOffset: end === chars.length ? null : end });
  while (bytes(JSON.stringify(result())) > 8192 && end > offset) end--;
  assert(bytes(JSON.stringify(result())) <= 8192);
  return result();
}
export const bytes = text => Buffer.byteLength(text, 'utf8');
export const render = records => records.map(n => `## ${n.heading}\n${n.content}`).join('\n\n');

// Relevance labels describe the intended fact, independently of literal matching.
export const queries = [
  ['coffee', 'en-literal', ['coffee']], ['COFFEE', 'en-literal', ['coffee']],
  ['Afternoon drinks', 'en-literal', ['coffee']], ['days_overdue', 'en-literal', ['collection']],
  ['strictly greater than 20', 'en-literal', ['collection']], ['A-17', 'en-literal', ['project']],
  ['Café', 'en-literal', ['accent']], ['concise weekly', 'en-literal', ['spacing']],
  ['ＡＢＣ', 'en-literal', ['unicode']], ['Warehouse Maple', 'en-literal', ['address-shared']],
  ['香港', 'zh-literal', ['city']], ['居住', 'zh-literal', ['city']],
  ['酒店', 'zh-literal', ['budget']], ['680', 'zh-literal', ['budget']],
  ['差旅预算', 'zh-literal', ['budget']], ['含税', 'zh-literal', ['budget']],
  ['回复语言', 'zh-literal', ['language']], ['原币种', 'zh-literal', ['language']],
  ['caffeine-free refreshment', 'en-paraphrase', ['coffee']], ['overdue threshold', 'en-paraphrase', ['collection']],
  ['brief responses', 'en-paraphrase', ['style']], ['lodging allowance', 'en-paraphrase', ['budget']],
  ['我住哪儿', 'zh-paraphrase', ['city']], ['住宿报销标准', 'zh-paraphrase', ['budget']],
  ['账单催收门槛', 'zh-paraphrase', ['collection']], ['精简作答', 'zh-paraphrase', ['style']],
  ['Hong Kong', 'cross-language', ['city']], ['咖啡', 'cross-language', ['coffee']],
  ['hotel budget', 'cross-language', ['budget']], ['配送目的地', 'cross-language', ['address-shared']],
  ['Cafe', 'normalization-limit', ['accent']], ['A–17', 'normalization-limit', ['project']], ['預算', 'normalization-limit', ['budget']],
  ['passport number', 'absent', []], ['护照号码', 'absent', []],
  ['Warehouse Cedar', 'suppressed', []], ['LANTERN-61', 'suppressed', []], ['MOVED-SECRET', 'suppressed', []],
];

export const tasks = [
  { id: 'irrelevant-en', kind: 'irrelevant', prompt: 'What is 17 times 3?', expected: /\b51\b/ },
  { id: 'irrelevant-zh', kind: 'irrelevant', prompt: '把“明天开会”翻译成英文。', expected: /tomorrow/i },
  { id: 'literal-en', kind: 'recall', prompt: 'For Project A-17, what date is the dry-run?', expected: /18.*November|November.*18|11月18/ },
  { id: 'literal-zh', kind: 'recall', prompt: '按我的差旅预算，酒店每晚含税最多多少钱？', expected: /680/ },
  { id: 'paraphrase-en', kind: 'recall', prompt: 'Suggest a suitable caffeine-free refreshment for me after lunch, based on my preferences.', expected: /rooibos/i },
  { id: 'paraphrase-zh', kind: 'recall', prompt: '我现在住哪儿？', expected: /香港|Hong Kong/i },
  { id: 'cross-en', kind: 'recall', prompt: 'What is my nightly hotel budget including tax?', expected: /680/ },
  { id: 'cross-zh', kind: 'recall', prompt: '现在未付款账单逾期多少天才需要催收？', expected: /20|二十/, forbidden: /(?:greater than|超过|大于)\s*14/ },
  { id: 'current-en', kind: 'recall', prompt: 'The old handover says Warehouse Cedar. What is the current delivery destination in memory?', expected: /Warehouse Maple/, forbidden: /(?:current|destination is)\s*(?:Warehouse )?Cedar/i },
  { id: 'long-zh', kind: 'recall', prompt: '记忆中的 Archive labels 最后写的柜子代码是什么？', expected: /IRIS-93/ },
  { id: 'absent-en', kind: 'absent', prompt: 'What is my passport number?', expected: /do not|don.t|not have|not (?:stored|recorded|available)|unknown|haven.t|no .*passport/i },
  { id: 'absent-zh', kind: 'absent', prompt: '我护照号码是多少？', expected: /不知道|没有|未.*(?:记录|存储|提供)|不清楚|无法/ },
];

export function probe() {
  for (const scope of ['bot', 'shared']) {
    assert(bytes(render(notes.filter(n => n.scope === scope && n.status === 'active'))) <= (scope === 'bot' ? 8192 : 4096));
    assert(notes.filter(n => n.scope === scope).length <= 128);
  }
  const results = queries.map(([query, category, expected]) => {
    const actual = search(query).hits.map(h => h.ref.noteId);
    return { query, category, expected, actual, relevantFound: expected.filter(id => actual.includes(id)).length };
  });
  for (const r of results.filter(r => /literal|absent|suppressed/.test(r.category))) assert.deepEqual(r.actual, r.expected);
  assert(eligible(notes, true).every(n => n.scope === 'bot'));
  assert(matches('Warehouse Cedar', eligible(notes, true)).length === 1);
  assert(!eligible().some(n => ['address-local', 'retired-local', 'moved'].includes(n.id)));
  assert(search('Workshop').hits.length === 5 && search('Workshop').truncated);
  assert(bytes(JSON.stringify(search('Workshop'))) <= 4096);
  assert.throws(() => search(' ')); assert.throws(() => search('x'.repeat(257)));
  const n = notes.find(n => n.id === 'long'); let text = '', offset = 0;
  for (;;) { const r = read(reference(n), offset); assert(bytes(r.text) <= 2048); text += r.text; if (r.complete) break; assert(r.nextOffset > offset); offset = r.nextOffset; }
  assert.equal(text, n.content);
  assert.equal(read({ ...reference(n), revisions: { local: 8, shared: 4 } }).error, 'unavailable');
  const ordered = reference(n);
  const reordered = Object.fromEntries(Object.entries(ordered).reverse());
  reordered.revisions = { shared: 4, local: 7 };
  assert.equal(read(reordered).ok, true);
  const escapeNote = note('escapes', 'Escapes', '\u0001'.repeat(2048) + '😀'.repeat(600));
  let recovered = '', cursor = 0;
  for (;;) { const r = read(reference(escapeNote), cursor, [escapeNote]); assert(bytes(JSON.stringify(r)) <= 8192); recovered += r.text; if (r.complete) break; assert(r.nextOffset > cursor); cursor = r.nextOffset; }
  assert.equal(recovered, escapeNote.content);
  assert.equal(read(reference(n), [...n.content].length).text, '');
  assert.equal(read(reference(n), [...n.content].length + 1).error, 'invalid_arguments');
  assert.throws(() => read(reference(n), -1));
  const dense = Array.from({ length: 256 }, (_, i) => note(String(i).padStart(3, '0'), `Topic ${i}`, 'match', i < 128 ? 'bot' : 'shared'));
  assert.deepEqual(search('match', dense).hits.map(h => h.ref.noteId), ['000', '001', '002', '003', '004']);
  const samples = [];
  for (let i = 0; i < 1000; i++) { const start = performance.now(); search('match', dense); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  const byCategory = Object.fromEntries([...new Set(results.map(r => r.category))].map(category => {
    const rows = results.filter(r => r.category === category);
    return [category, { queries: rows.length, relevant: rows.reduce((s, r) => s + r.expected.length, 0), found: rows.reduce((s, r) => s + r.relevantFound, 0), returned: rows.reduce((s, r) => s + r.actual.length, 0) }];
  }));
  return { node: process.version, scan: { notes: dense.length, iterations: samples.length, p50Ms: samples[500], p95Ms: samples[950] }, storedBytes: Object.fromEntries(['bot', 'shared'].map(scope => [scope, bytes(render(notes.filter(n => n.scope === scope && n.status === 'active')))])), eligibleBytes: bytes(render(eligible())), alwaysBytes: bytes(render(eligible().filter(n => n.placement === 'always'))), byCategory, results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(probe(), null, 2));
