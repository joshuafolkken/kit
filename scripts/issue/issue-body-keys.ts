import { session_language } from '#scripts/josh/session-language'

// joshuafolkken/kit#7209: the single source of the Issue body's declaration keys, their fixed
// values and the template's headings, as `issue-template.md` and `issue-template.en.md` write them. Each row
// holds one column per body language, so a language is a column added here rather than a literal
// changed across `scripts/`; the scan in `issue-body-keys.test.ts` keeps the literals here.
// joshuafolkken/kit#7210: a body is written in the `JOSH_SESSION_LANG` column and read in either —
// `canonical_line` rewrites a line written in the other column into the written one, so every reader
// that matches the written text accepts both.

interface Row {
	ja: string
	en: string
}

type Column = keyof Row

const KEYS = {
	kind: { ja: '種別', en: 'Type' },
	purpose: { ja: '目的', en: 'Purpose' },
	compatibility: { ja: '互換性', en: 'Compatibility' },
	release: { ja: 'リリース分類', en: 'Release classification' },
	judgement: { ja: '人の判断', en: 'Human judgement' },
	decision_rule: { ja: '判定規則', en: 'Decision rule' },
	priority: { ja: '優先度', en: 'Priority' },
	security: { ja: 'セキュリティ', en: 'Security' },
	cause_park: { ja: '原因の park', en: 'Cause park' },
	cause_lane: { ja: '原因のレーン', en: 'Cause lane' },
	cause_loss: { ja: '原因の損失', en: 'Cause loss' },
	order: { ja: '実施順', en: 'Order' },
	origin: { ja: '原因', en: 'Cause' },
	size: { ja: '規模見積もり', en: 'Size estimate' },
	no_split_reason: { ja: '分割しない理由', en: 'No-split reason' },
	no_lines: { ja: '行を増やさない', en: 'No added lines' },
	refactor_first: { ja: '先行リファクタ', en: 'Refactor first' },
	enforcement: { ja: '強制', en: 'Enforcement' },
	measurement: { ja: '計測', en: 'Measurement' },
	measure_declaration: { ja: '計測宣言', en: 'Measure declaration' },
	premise: { ja: '前提', en: 'Premise' },
	measure_absent: { ja: '計測宣言なし', en: 'No measure declaration' },
	sample_gate: { ja: '実施可能条件', en: 'Sample gate' },
	not_before: { ja: '実施可能日', en: 'Not before' },
	source: { ja: '出どころ', en: 'Source' },
} as const satisfies Record<string, Row>

const VALUES = {
	bug: { ja: '不具合', en: 'defect' },
	non_bug: { ja: '非不具合', en: 'non-defect' },
	behavior_change: { ja: '振る舞い変更', en: 'behavior change' },
	feature: { ja: '機能追加', en: 'feature' },
	improvement: { ja: '機能改善', en: 'improvement' },
	time_saving: { ja: '時間短縮', en: 'time saving' },
	bug_fix: { ja: '不具合修正', en: 'bug fix' },
	breaking: { ja: '破壊的変更', en: 'breaking change' },
	not_needed: { ja: '不要', en: 'not needed' },
	needed: { ja: '要', en: 'needed' },
	normal: { ja: '通常', en: 'normal' },
	high: { ja: '高', en: 'high' },
	critical: { ja: '緊急', en: 'critical' },
	last: { ja: '最後', en: 'last' },
	unknown: { ja: '不明', en: 'unknown' },
	none: { ja: 'なし', en: 'none' },
} as const satisfies Record<string, Row>

const HEADINGS = {
	background: { ja: '背景', en: 'Background' },
	symptom: { ja: '現象', en: 'Symptom' },
	expected: { ja: '期待結果', en: 'Expected result' },
	criteria: { ja: '受け入れ条件', en: 'Acceptance criteria' },
	trigger: { ja: '発火点', en: 'Trigger' },
	baseline: { ja: 'ベースライン', en: 'Baseline' },
	reproduction: { ja: '再現', en: 'Reproduction' },
	expected_effect: { ja: '期待効果', en: 'Expected effect' },
} as const satisfies Record<string, Row>

// The size estimate's value: `<files>` and `<lines>` stand for its counts.
const SIZE_VALUES = {
	ja: '約 <files> ファイル / <lines> 行（テスト除く）',
	en: 'about <files> files / <lines> lines (excluding tests)',
} as const satisfies Row
// Full- or half-width parentheses alike: the two read the same to the person typing the line.
const SIZE_PATTERNS = [
	/^約\s*(?<files>\d+)\s*ファイル\s*\/\s*(?<lines>\d+)\s*行\s*[（(]テスト除く[）)]$/u,
	/^about\s*(?<files>\d+)\s*files?\s*\/\s*(?<lines>\d+)\s*lines?\s*\(excluding tests\)$/iu,
]

type IssueBodyKey = keyof typeof KEYS
type IssueBodyValue = keyof typeof VALUES
type IssueBodyHeading = keyof typeof HEADINGS

const COLUMNS: ReadonlyArray<Column> = ['ja', 'en']
const HEADING_PREFIX = '## '
const BULLET = '- '
const KEY_END = ':'
// A value ends where a word could not go on: the line's end, a space or punctuation.
const VALUE_END = /^(?:$|[^\p{L}\p{N}-])/u
const VALUE_TEXTS = Object.values(VALUES)
	.flatMap((row) => COLUMNS.map((at) => ({ row, text: row[at] })))
	.toSorted((left, right) => right.text.length - left.text.length)

// The column the body is written in: the session language's.
function column(): Column {
	return session_language.is_japanese(session_language.resolve_session_lang().lang) ? 'ja' : 'en'
}

function text_of(row: Row): string {
	return row[column()]
}

function key(name: IssueBodyKey): string {
	return text_of(KEYS[name])
}

function value(name: IssueBodyValue): string {
	return text_of(VALUES[name])
}

// The start every declaration line of `name` shares: `- <key>:`.
function prefix(name: IssueBodyKey): string {
	return `- ${key(name)}:`
}

// A whole declaration line with a fixed value: `- <key>: <value>`.
function line(name: IssueBodyKey, value_name: IssueBodyValue): string {
	return `${prefix(name)} ${value(value_name)}`
}

// The declaration prefix in every column, for a match on the body as the filer wrote it.
function prefix_variants(name: IssueBodyKey): ReadonlyArray<string> {
	return COLUMNS.map((at) => `- ${KEYS[name][at]}:`)
}

// The declaration line in every column, for a match on the body as the filer wrote it.
function line_variants(name: IssueBodyKey, value_name: IssueBodyValue): ReadonlyArray<string> {
	return COLUMNS.map((at) => `- ${KEYS[name][at]}: ${VALUES[value_name][at]}`)
}

// A template heading as the body writes it: `## <heading>`.
function heading(name: IssueBodyHeading): string {
	return `## ${text_of(HEADINGS[name])}`
}

function size_value(files: string, lines: string): string {
	return text_of(SIZE_VALUES)
		.replace('<files>', () => files)
		.replace('<lines>', () => lines)
}

// The counts a size estimate's value declares, in either column; `undefined` when it does not parse.
function size_counts(text: string): Record<string, string> | undefined {
	return SIZE_PATTERNS.map((pattern) => pattern.exec(text)?.groups).find(Boolean)
}

// The row whose text in any column is `text`.
function row_named(rows: Record<string, Row>, text: string): Row | undefined {
	return Object.values(rows).find((row) => COLUMNS.some((at) => row[at] === text))
}

function indent_of(raw: string): string {
	return raw.slice(0, raw.length - raw.trimStart().length)
}

// `rest` with the fixed value it starts with rewritten into the written column; the longest value is
// tried first, so a value is never read as a shorter one it ends with.
function canonical_value(rest: string): string {
	const trimmed = rest.trimStart()
	const found = VALUE_TEXTS.find(
		({ text }) => trimmed.startsWith(text) && VALUE_END.test(trimmed.slice(text.length)),
	)

	if (found === undefined) return rest

	return `${indent_of(rest)}${text_of(found.row)}${trimmed.slice(found.text.length)}`
}

function canonical_declaration(raw: string): string | undefined {
	const text = raw.trimStart()
	const end = text.indexOf(KEY_END)
	const row =
		end !== -1 && text.startsWith(BULLET)
			? row_named(KEYS, text.slice(BULLET.length, end))
			: undefined

	return row === undefined
		? undefined
		: `${indent_of(raw)}${BULLET}${text_of(row)}${KEY_END}${canonical_value(text.slice(end + 1))}`
}

function canonical_heading(raw: string): string | undefined {
	const text = raw.trim()
	const row = text.startsWith(HEADING_PREFIX)
		? row_named(HEADINGS, text.slice(HEADING_PREFIX.length))
		: undefined

	return row === undefined ? undefined : `${indent_of(raw)}${HEADING_PREFIX}${text_of(row)}`
}

// `raw` with a heading, declaration key and fixed value written in any column rewritten into the
// written column; any other line is unchanged.
function canonical_line(raw: string): string {
	return canonical_heading(raw) ?? canonical_declaration(raw) ?? raw
}

// Every row, for `issue-template.en.md`'s correspondence table to be held to (joshuafolkken/kit#7211).
const TABLES = { keys: KEYS, values: VALUES, headings: HEADINGS }

const issue_body_keys = {
	canonical_line,
	column,
	heading,
	line,
	line_variants,
	prefix,
	prefix_variants,
	size_counts,
	size_value,
	TABLES,
	value,
}

export type { Column, IssueBodyHeading, IssueBodyKey, IssueBodyValue }
export { issue_body_keys }
