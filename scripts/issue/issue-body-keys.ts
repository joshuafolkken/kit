// joshuafolkken/kit#7209: the single source of the Issue body's declaration keys, their fixed
// values and the template's headings, as `issue-template.md` writes them. Each row
// holds one column per body language, so a language is a column added here rather than a literal
// changed across `scripts/`; the scan in `issue-body-keys.test.ts` keeps the literals here.

interface Row {
	ja: string
}

const KEYS = {
	kind: { ja: '種別' },
	purpose: { ja: '目的' },
	compatibility: { ja: '互換性' },
	release: { ja: 'リリース分類' },
	judgement: { ja: '人の判断' },
	decision_rule: { ja: '判定規則' },
	priority: { ja: '優先度' },
	security: { ja: 'セキュリティ' },
	cause_park: { ja: '原因の park' },
	cause_lane: { ja: '原因のレーン' },
	cause_loss: { ja: '原因の損失' },
	order: { ja: '実施順' },
	origin: { ja: '原因' },
	size: { ja: '規模見積もり' },
	no_split_reason: { ja: '分割しない理由' },
	no_lines: { ja: '行を増やさない' },
	refactor_first: { ja: '先行リファクタ' },
	enforcement: { ja: '強制' },
	measurement: { ja: '計測' },
	measure_declaration: { ja: '計測宣言' },
	premise: { ja: '前提' },
	measure_absent: { ja: '計測宣言なし' },
	sample_gate: { ja: '実施可能条件' },
	not_before: { ja: '実施可能日' },
	source: { ja: '出どころ' },
} as const satisfies Record<string, Row>

const VALUES = {
	bug: { ja: '不具合' },
	non_bug: { ja: '非不具合' },
	behavior_change: { ja: '振る舞い変更' },
	feature: { ja: '機能追加' },
	improvement: { ja: '機能改善' },
	time_saving: { ja: '時間短縮' },
	bug_fix: { ja: '不具合修正' },
	breaking: { ja: '破壊的変更' },
	not_needed: { ja: '不要' },
	needed: { ja: '要' },
	normal: { ja: '通常' },
	high: { ja: '高' },
	critical: { ja: '緊急' },
	last: { ja: '最後' },
	unknown: { ja: '不明' },
	none: { ja: 'なし' },
} as const satisfies Record<string, Row>

const HEADINGS = {
	background: { ja: '背景' },
	symptom: { ja: '現象' },
	expected: { ja: '期待結果' },
	criteria: { ja: '受け入れ条件' },
	trigger: { ja: '発火点' },
	baseline: { ja: 'ベースライン' },
	reproduction: { ja: '再現' },
	expected_effect: { ja: '期待効果' },
} as const satisfies Record<string, Row>

type IssueBodyKey = keyof typeof KEYS
type IssueBodyValue = keyof typeof VALUES
type IssueBodyHeading = keyof typeof HEADINGS

// The column the body is written in; the one place a second language picks its column.
function text_of(row: Row): string {
	return row.ja
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

// A template heading as the body writes it: `## <heading>`.
function heading(name: IssueBodyHeading): string {
	return `## ${text_of(HEADINGS[name])}`
}

const issue_body_keys = { heading, line, prefix, value }

export type { IssueBodyHeading, IssueBodyKey, IssueBodyValue }
export { issue_body_keys }
