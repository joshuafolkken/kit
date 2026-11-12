import { afterEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#7210: an Issue body passes `issue:lint` and gets its classification labels in
// either language whatever `JOSH_SESSION_LANG` is. The readers fix their keys at module load, so each
// case loads them afresh under its language.

const JAPANESE_NON_BUG = '- 種別: 非不具合'
const ENGLISH_NON_BUG = '- Type: non-defect'
const JAPANESE_BODY = [
	'## 背景',
	'',
	JAPANESE_NON_BUG,
	'- 目的: 機能改善',
	'- 互換性: 破壊的変更',
	'- 人の判断: 不要',
	'- 規模見積もり: 約 2 ファイル / 30 行（テスト除く）',
	'',
	'## 現象',
	'',
	'## 期待結果',
	'',
	'## 受け入れ条件',
	'',
].join('\n')
const ENGLISH_BODY = [
	'## Background',
	'',
	ENGLISH_NON_BUG,
	'- Purpose: improvement',
	'- Compatibility: breaking change',
	'- Human judgement: not needed',
	'- Size estimate: about 2 files / 30 lines (excluding tests)',
	'',
	'## Symptom',
	'',
	'## Expected result',
	'',
	'## Acceptance criteria',
	'',
].join('\n')

interface Verdict {
	problems: ReadonlyArray<string>
	labels: ReadonlyArray<string>
}

function under(lang: string): void {
	vi.stubEnv('JOSH_SESSION_LANG', lang)
	vi.resetModules()
}

async function verdict(lang: string, body: string): Promise<Verdict> {
	under(lang)
	const { issue_lint_cli } = await import('./issue-lint-cli')
	const { issue_classification } = await import('./issue-classification')

	return {
		problems: issue_lint_cli.problems(body),
		labels: issue_classification.required_labels(body),
	}
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('an Issue body in either language', () => {
	it.each([
		{ lang: 'ja', body: JAPANESE_BODY },
		{ lang: 'ja', body: ENGLISH_BODY },
		{ lang: 'en', body: JAPANESE_BODY },
		{ lang: 'en', body: ENGLISH_BODY },
	])('passes and is labelled alike under $lang', async ({ lang, body }) => {
		expect(await verdict(lang, body)).toStrictEqual({
			problems: [],
			labels: ['enhancement', 'breaking-change'],
		})
	})
})

describe('auto-ok provenance in either language', () => {
	it.each(['ja', 'en'])('preserves both body languages under %s', async (lang) => {
		under(lang)
		const { issue_auto_ok } = await import('./issue-auto-ok')
		const bodies = [
			'## 自動実行の制約\n- 出所: user\n- 参照: session:prompt\n- 指示: 自動実行禁止',
			'## Automatic execution constraint\n- Constraint source: user\n- Constraint reference: session:prompt\n- Constraint instruction: Do not run automatically',
		]

		expect(bodies.map((body) => issue_auto_ok.user_constraint_of(body)?.is_applied)).toEqual([
			false,
			false,
		])
	})
})

describe('a line josh writes into an Issue body', () => {
	it.each([
		{ lang: 'ja', non_bug: JAPANESE_NON_BUG },
		{ lang: 'ja', non_bug: ENGLISH_NON_BUG },
		{ lang: 'en', non_bug: JAPANESE_NON_BUG },
		{ lang: 'en', non_bug: ENGLISH_NON_BUG },
	])(
		'writes other-change under the non-bug line $non_bug under $lang',
		async ({ lang, non_bug }) => {
			under(lang)
			const { issue_classification } = await import('./issue-classification')
			const body = `## 背景\n\n${non_bug}\n`
			const lines = issue_classification.with_release_classification(body).split('\n')

			expect(lines[lines.indexOf(non_bug) + 1]).toMatch(/other-change$/u)
		},
	)

	it('drafts a review-cap filing with its size estimate in the session language', async () => {
		under('en')
		const { disposition_batch } = await import('#scripts/review/disposition-batch')
		const { disposition_batch_filing } = await import('#scripts/review/disposition-batch-filing')
		const parsed = disposition_batch.parse('confirmed bug-risks:medium:scripts/foo.ts:12 — x')
		const [finding] = 'findings' in parsed ? parsed.findings : []

		if (finding === undefined) throw new Error('fixture did not parse')

		expect(disposition_batch_filing.body_of(finding, 1)).toContain(
			'- Size estimate: about 1 files / 20 lines (excluding tests)',
		)
	})

	it('names the missing heading in the session language', async () => {
		const { problems } = await verdict('en', '')

		expect(problems.map((problem) => problem.split('\n', 1)[0])).toContain(
			'missing heading: ## Background',
		)
	})
})
