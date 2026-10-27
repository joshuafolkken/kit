import { describe, expect, it } from 'vitest'
import { issue_sample_gate } from './issue-sample-gate'
import { issue_sample_required } from './issue-sample-required'
import { measure_declaration } from './measure-declaration'

// joshuafolkken/kit#4901: a measurement follow-up filed without its start condition is refused with the
// declaration line it owes; one that declares it, and any filing that is not a measurement, passes.

const NO_FILES = '- 規模見積もり: 約 0 ファイル / 0 行（テスト除く）'
const SOME_FILES = '- 規模見積もり: 約 2 ファイル / 60 行（テスト除く）'
const CONDITION = '- 実施可能条件: #4899 のマージ後 10 マージ'
const MEASURE = '- 計測宣言: `pnpm josh lane:stats --period 1` <= 300'
const NO_MEASURE = '- 計測宣言なし: Actions のジョブ時間はどのコマンドも 1 個の数値で出さない'
const MEASURING = '- [ ] #4896 のマージ後の期間で `pnpm josh lane:stats` を取り、中央値を記録する'
const FOLLOW_UP = '- [ ] 中央値が下がっていなければ、原因を調べて Issue を起こす'
const CHANGING = '- [ ] `issue:file` が refuse する'
const INVESTIGATING = '- [ ] `gh api repos/o/r/actions/runs/1/jobs` で遅い step を特定する'
// #5101 as filed: its criteria read the merges after #5090 through no `lane:stats` or `actions/runs`.
const SHARD_MEDIANS =
	'- [ ] #5090 のマージ後 10 マージ分の Unit Tests shard の最長ジョブ時間と `Checks` の完了の中央値を書く'
const CHECKS_WAIT =
	'- [ ] 同じ 10 マージの followup `checks-wait`（`pnpm josh ship --log <N>` の stage 行）の中央値が縮んでいる'

function body_of(estimate: string, criteria: ReadonlyArray<string>, extra = ''): string {
	const background = ['## 背景', '', '- 種別: 非不具合', estimate, extra].join('\n')

	return [
		background,
		'## 現象\n\nx',
		'## 期待結果\n\ny',
		['## 受け入れ条件', '', ...criteria].join('\n'),
	].join('\n\n')
}

describe('issue_sample_required.problem — a measurement follow-up with no start condition', () => {
	it('refuses one reading lane:stats about a cited change, naming the declaration line', () => {
		const found = issue_sample_required.problem(body_of(NO_FILES, [MEASURING, FOLLOW_UP]))

		expect(found).toContain(issue_sample_gate.DECLARATION)
		expect(found).toContain(issue_sample_gate.CLOSING_FORMAT)
	})

	it.each([
		[
			'reads the Actions runs of a cited change',
			body_of(NO_FILES, ['- [ ] #4896 後の `actions/runs` を読む']),
		],
		[
			'reads the merges after a cited change by any record (#5101)',
			body_of(NO_FILES, [SHARD_MEDIANS, CHECKS_WAIT]),
		],
		[
			'reads the period after the PR closing a cited issue',
			body_of(NO_FILES, ['- [ ] #4896 を閉じる PR のマージ以降の `ship --log` を読む']),
		],
		[
			'carries a measure declaration, whatever its estimate',
			body_of(SOME_FILES, [FOLLOW_UP], MEASURE),
		],
		[
			'carries a malformed start condition',
			body_of(NO_FILES, [MEASURING], '- 実施可能条件: #4899 のあと'),
		],
	])('refuses one that %s', (_case, body) => {
		expect(issue_sample_required.problem(body)).toBeDefined()
	})
})

describe('issue_sample_required.problem — the wordings of the period after a cited change', () => {
	it.each([
		'- [ ] #4896 以後の中央値を記録する',
		'- [ ] #4896後の中央値を記録する',
		'- [ ] #4896 の後の中央値を記録する',
		'- [ ] #4896 のマージ直後 5 マージの中央値を記録する',
		'- [ ] #4896 をマージした後の中央値を記録する',
		'- [ ] #4896 を閉じるPRのマージ後の中央値を記録する',
		'- [ ] `pnpm josh lane:stats` で #4896 の効果を測る',
	])('refuses "%s" with no start condition', (criterion) => {
		expect(issue_sample_required.problem(body_of(NO_FILES, [criterion]))).toBeDefined()
	})
})

// joshuafolkken/kit#5144: one waiting K merges declares its measurement, or says why it has none.
describe('issue_sample_required.problem — a measurement follow-up with no measure declaration', () => {
	it.each([
		['measures with its start condition alone', body_of(NO_FILES, [MEASURING], CONDITION)],
		['changes files but waits K merges', body_of(SOME_FILES, [CHANGING], CONDITION)],
		['gives an empty reason', body_of(NO_FILES, [MEASURING], `${CONDITION}\n- 計測宣言なし:`)],
	])('refuses one that %s, naming both ways out', (_case, body) => {
		const found = issue_sample_required.problem(body)

		expect(found).toContain(measure_declaration.DECLARATION)
		expect(found).toContain(measure_declaration.ABSENT)
		expect(found?.split('\n').at(-1)).toBe(measure_declaration.EXAMPLE)
	})

	it.each([
		['states a reason', body_of(NO_FILES, [MEASURING], `${CONDITION}\n${NO_MEASURE}`)],
		[
			'measures #5101 stating a reason',
			body_of(NO_FILES, [SHARD_MEDIANS], `${CONDITION}\n${NO_MEASURE}`),
		],
	])('passes one that %s for no declaration', (_case, body) => {
		expect(issue_sample_required.problem(body)).toBeUndefined()
	})

	it('leaves a malformed declaration to its own format refusal', () => {
		const malformed = '- 計測宣言: lane:stats <= 300'

		expect(
			issue_sample_required.problem(body_of(NO_FILES, [MEASURING], `${CONDITION}\n${malformed}`)),
		).toBeUndefined()
	})
})

describe('issue_sample_required.problem — filings that pass as before', () => {
	it.each([
		[
			'carries a measure declaration and its start condition',
			body_of(NO_FILES, [FOLLOW_UP], `${MEASURE}\n${CONDITION}`),
		],
		['changes files though a criterion reads lane:stats', body_of(SOME_FILES, [MEASURING])],
		['investigates CI records citing no change', body_of(NO_FILES, [INVESTIGATING])],
		[
			'cites a change without reading the period after it',
			body_of(NO_FILES, ['- [ ] #4896 で失敗した step を特定する']),
		],
		...['- [ ] #4896 の後始末として残ったラベルを削除する', '- [ ] #4896 の後述の手順を直す'].map(
			(criterion) => [`opens a word with "after": ${criterion}`, body_of(NO_FILES, [criterion])],
		),
		...[
			'- [ ] #4896 の調査の最後に結果を書く',
			'- [ ] #4896 の前後の差分を説明する',
			'- [ ] #4896 の手順を今後の手引きに書く',
			'- [ ] #4896 の失敗の直後に出たログを貼る',
			'- [ ] #4896 の後続 Issue を閉じる',
		].map((criterion) => [`uses "after" in a word: ${criterion}`, body_of(NO_FILES, [criterion])]),
		['changes no file and reads no record', body_of(NO_FILES, [FOLLOW_UP])],
		['changes files and reads no record', body_of(SOME_FILES, [CHANGING])],
		['declares no estimate', body_of('', [MEASURING])],
	])('passes a filing that %s', (_case, body) => {
		expect(issue_sample_required.problem(body)).toBeUndefined()
	})
})
