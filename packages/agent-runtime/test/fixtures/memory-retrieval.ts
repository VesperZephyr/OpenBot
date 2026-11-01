import type { MemoryNote, MemoryScope } from "@openbot/protocol";
const note = (id: string, heading: string, content: string, scope: MemoryScope = "bot", placement: "always" | "on-demand" = "on-demand", status: MemoryNote["status"] = "active") =>
 ({ id, heading, content, scope, placement, status, key: heading.normalize("NFKC").trim().toLowerCase(), protected: true, original: {kind: "user" as const, at: 1}, changed: {kind: "user" as const, at: 1} });
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
export const queries: [string, string, string[]][] = [
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

