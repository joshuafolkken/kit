import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { expected_effect_lint } from './expected-effect-lint'
import { issue_cite } from './issue-cite'
import { has_label_name, MEASURED_LABEL, MEASURED_UNMET_LABEL } from './issue-labels'
import type { SearchIssue } from './issue-search'

// joshuafolkken/kit#4958: a run-time-shortening issue states its expected effect at filing
// (`expected-effect-lint.ts`), and nothing read it again once merged. This sets each closed one beside
// the follow-up measurements that cite it — issues with a run condition line naming `#<N>` — and their
// recorded verdict: `measured:unmet` fell short, `measured` alone reached it, anything else is not
// measured yet. A shortfall is drafted as a retirement candidate for `issue:file`.

const FOLLOW_UP_PREFIX = '- 実施可能条件:'
const EFFECT_LABELS: ReadonlyArray<string> = ['効く率', '1 回あたりの得', '外れたときの損']
const NO_VALUE = '—'
const RESULTS = ['met', 'unmet', 'unmeasured'] as const

type EffectResult = (typeof RESULTS)[number]

interface AuditRow {
	origin: SearchIssue
	follow_ups: ReadonlyArray<SearchIssue>
	result: EffectResult
}

const RESULT_WORDS: Readonly<Record<EffectResult, string>> = {
	met: '届いた',
	unmet: '届かなかった',
	unmeasured: '未計測',
}

// Plain: the rows feed an issue body as well as the session, which links them where it prints them.
function cite(issue: SearchIssue): string {
	return issue_cite.plain(issue.number)
}

// The closed time-shortening issues of the window. The search narrows by the declaration's words; the
// exact line under the background heading is checked on each body, since the search matches the
// follow-ups' own "confirm the shortening" aim too.
function origin_query(repo: string, since: string): string {
	return `repo:${repo} is:issue is:closed reason:completed closed:>=${since} "目的: 時間短縮" in:body`
}

// Every follow-up measurement, of any date: one may be filed before or long after its origin closed.
function follow_up_query(repo: string): string {
	return `repo:${repo} is:issue "実施可能条件" in:body`
}

function is_follow_up(issue: SearchIssue): boolean {
	return issue.body.split('\n').some((line) => line.trimStart().startsWith(FOLLOW_UP_PREFIX))
}

function cites_origin(issue: SearchIssue, origin: SearchIssue): boolean {
	return (
		issue.number !== origin.number &&
		git_gh_issue_list.has_token_occurrence(issue.body, cite(origin))
	)
}

// One shortfall outweighs any reach: a mechanism some measurement found wanting is the one to look at.
function result_of(follow_ups: ReadonlyArray<SearchIssue>): EffectResult {
	if (follow_ups.some((issue) => has_label_name(issue.labels, MEASURED_UNMET_LABEL))) return 'unmet'

	return follow_ups.some((issue) => has_label_name(issue.labels, MEASURED_LABEL))
		? 'met'
		: 'unmeasured'
}

function row_of(origin: SearchIssue, follow_ups: ReadonlyArray<SearchIssue>): AuditRow {
	const cited = follow_ups.filter((issue) => cites_origin(issue, origin))

	return { origin, follow_ups: cited, result: result_of(cited) }
}

function rows(
	origins: ReadonlyArray<SearchIssue>,
	candidates: ReadonlyArray<SearchIssue>,
): ReadonlyArray<AuditRow> {
	const follow_ups = candidates.filter((issue) => is_follow_up(issue))

	return origins
		.filter((origin) => expected_effect_lint.is_target(origin.body))
		.map((origin) => row_of(origin, follow_ups))
}

function effect_text(body: string): string {
	return EFFECT_LABELS.map(
		(label) => `${label} ${expected_effect_lint.value_of(body, label) ?? NO_VALUE}`,
	).join(' · ')
}

function follow_up_text(follow_ups: ReadonlyArray<SearchIssue>): string {
	if (follow_ups.length === 0) return 'なし'

	return follow_ups.map((issue) => `${cite(issue)} (${issue.state})`).join(', ')
}

function format_row(row: AuditRow): string {
	const effect = `期待効果: ${effect_text(row.origin.body)}`
	const measured = `後続計測: ${follow_up_text(row.follow_ups)}`

	return `${cite(row.origin)} — ${effect} — ${measured} — 結果: ${RESULT_WORDS[row.result]}`
}

function tally(audit_rows: ReadonlyArray<AuditRow>, result: EffectResult): string {
	return `${RESULT_WORDS[result]} ${String(audit_rows.filter((row) => row.result === result).length)}`
}

function summary(audit_rows: ReadonlyArray<AuditRow>, since: string): string {
	const tallies = RESULTS.map((result) => tally(audit_rows, result)).join(' · ')

	return `effect:audit — closed since ${since}: ${String(audit_rows.length)} issues · ${tallies}`
}

function unmet_measurements(row: AuditRow): string {
	return row.follow_ups
		.filter((issue) => has_label_name(issue.labels, MEASURED_UNMET_LABEL))
		.map((issue) => cite(issue))
		.join(', ')
}

function draft_title(row: AuditRow): string {
	return `Retire or shrink the mechanism of ${cite(row.origin)}, which fell short of its expected effect`
}

function background_lines(origin: string, measurements: string): ReadonlyArray<string> {
	return [
		'## 背景',
		'',
		'- 種別: 非不具合',
		'- 目的: 機能改善',
		'- 人の判断: 不要',
		'- 優先度: 通常',
		'- 規模見積もり: 約 <N> ファイル / <M> 行（テスト除く）',
		`- 出どころ: ${measurements} の計測（\`measured:unmet\`）`,
		'',
		`${origin} で足した機構は、後続計測 ${measurements} で期待効果に届かなかった。効かない機構は利用者の実行時間・読む量・保守の負担を増やすので、撤去するか、効く範囲に縮小する。`,
	]
}

// The retirement candidate's body. The angle-bracket lines are what only the filer knows: `issue:lint`
// refuses them until they are filled, and `issue:file`'s scout stops a duplicate.
function draft_body(row: AuditRow): string {
	const origin = cite(row.origin)
	const measurements = unmet_measurements(row)

	return [
		...background_lines(origin, measurements),
		'',
		'## 現象',
		'',
		`- ${origin} の期待効果: ${effect_text(row.origin.body)}`,
		`- 計測 ${measurements} の結果: 届かなかった`,
		'- 機構の所在: <ファイル・コマンド>',
		'',
		'## 期待結果',
		'',
		`- ${origin} で足した機構が撤去されているか、効く範囲に縮小されている`,
		'',
		'## 受け入れ条件',
		'',
		`- [ ] ${origin} で足した機構を撤去するか縮小し、どちらを選んだかとその理由を記録する`,
		'',
	].join('\n')
}

const effect_audit = {
	draft_body,
	draft_title,
	follow_up_query,
	format_row,
	origin_query,
	rows,
	summary,
}

export type { AuditRow, EffectResult }
export { effect_audit }
