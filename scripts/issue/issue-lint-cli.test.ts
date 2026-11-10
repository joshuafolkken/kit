import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cli_body_repository } from '#scripts/josh/cli-body-repository-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_lint_cli } from './issue-lint-cli'
import { issue_template_section } from './issue-template-section'

const make_directory = temporary_directory()
const VALID_BODY = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）\n'
const REQUIRED_SECTIONS = '## 現象\n\n## 期待結果\n\n## 受け入れ条件\n'
const ENHANCEMENT_OUTPUT = 'labels: enhancement'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue:lint label output', () => {
	it.each([
		{ body: `${VALID_BODY}- 種別: 不具合\n- 原因: #4201\n`, expected: 'labels: bug' },
		{ body: `${VALID_BODY}- 種別: 非不具合\n- 目的: 機能追加\n`, expected: ENHANCEMENT_OUTPUT },
		{ body: `${VALID_BODY}- 種別: 非不具合\n- 目的: 機能改善\n`, expected: ENHANCEMENT_OUTPUT },
		{
			body: `${VALID_BODY}- 種別: 非不具合\n- 互換性: 破壊的変更\n`,
			expected: 'labels: breaking-change',
		},
		{
			body: `${VALID_BODY}- 種別: 非不具合\n- 目的: 機能改善\n- 互換性: 破壊的変更\n`,
			expected: 'labels: enhancement, breaking-change',
		},
		{ body: `${VALID_BODY}- 種別: 非不具合\n`, expected: 'labels: none' },
	])('prints $expected for the issue body', async ({ body, expected }) => {
		const directory = make_directory('issue-lint-label-')
		const body_path = path.join(directory, 'issue.md')

		await writeFile(body_path, `${body}${REQUIRED_SECTIONS}`)
		const report = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_lint_cli.run(body_path)).toBe(0)
		expect(report).toHaveBeenCalledWith(expected)
	})
})

// joshuafolkken/kit#6056: the body is read through `cli_body`, so one left in the work tree is refused.
describe('issue_lint_cli.run — where the body sits', () => {
	it('refuses a body in the work tree that git does not ignore', async () => {
		const repository = cli_body_repository.create(make_directory('issue-lint-repository-'))
		const body_path = repository.write(cli_body_repository.UNIGNORED_DIRECTORY, VALID_BODY)

		await expect(issue_lint_cli.run(body_path)).rejects.toThrow('not git-ignored')
	})
})

// joshuafolkken/kit#5310: running last and a raised priority contradict each other.
describe('issue:lint run-last declaration', () => {
	const LAST_BODY = `${VALID_BODY}- 種別: 非不具合\n- 実施順: 最後\n`

	it('accepts a run-last declaration alone', () => {
		expect(issue_lint_cli.problems(`${LAST_BODY}${REQUIRED_SECTIONS}`)).toStrictEqual([])
	})

	it('refuses a run-last declaration beside a high priority', () => {
		const raised = `${LAST_BODY}- 優先度: 高（期限）\n${REQUIRED_SECTIONS}`

		expect(issue_lint_cli.problems(raised).join('\n')).toContain('- 実施順: 最後')
	})
})

// joshuafolkken/kit#6029: a behavior-change body names what stops a violation and what measures it.
describe('issue:lint enforcement declaration', () => {
	it('refuses a behavior-change body with no enforcement line', () => {
		const body = `${VALID_BODY}- 種別: 振る舞い変更\n- 計測: \`pnpm josh lane:stats\`\n${REQUIRED_SECTIONS}`

		expect(issue_lint_cli.problems(body).join('\n')).toContain('- 強制:')
	})
})

describe('issue:lint fenced headings', () => {
	it('rejects required headings that appear only inside a fenced example', async () => {
		const directory = make_directory('issue-lint-fenced-heading-')
		const body_path = path.join(directory, 'issue.md')

		await writeFile(body_path, `\`\`\`md\n## 背景\n- 種別: 不具合\n\`\`\`\n${REQUIRED_SECTIONS}`)
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_lint_cli.run(body_path)).toBe(1)
		expect(report).toHaveBeenCalledWith(
			expect.stringMatching(
				/^✖ missing heading: ## 背景\n## 背景\n[^✖]+\n✖ missing bug classification\n✖ missing size estimate/u,
			),
		)
	})
})

describe('issue:lint classification failures', () => {
	it('rejects an unclassified failure report', async () => {
		const directory = make_directory('issue-lint-unclassified-')
		const body_path = path.join(directory, 'issue.md')

		await writeFile(
			body_path,
			`${VALID_BODY}サブディレクトリから起動すると監査が走らない。\n${REQUIRED_SECTIONS}`,
		)
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_lint_cli.run(body_path)).toBe(1)
		expect(report).toHaveBeenCalledWith('✖ missing bug classification')
	})

	it('rejects conflicting bug and enhancement declarations', async () => {
		const directory = make_directory('issue-lint-conflict-')
		const body_path = path.join(directory, 'issue.md')

		await writeFile(
			body_path,
			`${VALID_BODY}- 種別: 不具合\n- 原因: #4201\n- 目的: 機能改善\n${REQUIRED_SECTIONS}`,
		)
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_lint_cli.run(body_path)).toBe(1)
		expect(report).toHaveBeenCalledWith('✖ bug and enhancement declarations cannot be combined')
	})
})

const SHORTENING_BODY = `${VALID_BODY}- 種別: 非不具合\n- 目的: 時間短縮\n${REQUIRED_SECTIONS}`
const EXPECTED_EFFECT_SECTION =
	'## 期待効果\n\n- 効く率: 19%\n- 1 回あたりの得: 2.0 分\n- 外れたときの損: CI 1 回\n- 出典: `pnpm josh lane:stats` → 2.0\n'

async function lint_body(body: string): Promise<number> {
	const directory = make_directory('issue-lint-expected-effect-')
	const body_path = path.join(directory, 'issue.md')

	await writeFile(body_path, body)

	return await issue_lint_cli.run(body_path)
}

describe('issue:lint expected effect (joshuafolkken/kit#3909)', () => {
	it('rejects a run-time-shortening body without the expected-effect section', async () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await lint_body(SHORTENING_BODY)).toBe(1)
		expect(report).toHaveBeenCalledWith(expect.stringMatching(/^✖ missing heading: ## 期待効果\n/u))
	})

	it('follows the missing heading with its template section (joshuafolkken/kit#5206)', async () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await lint_body(SHORTENING_BODY)

		expect(report).toHaveBeenCalledWith(
			`✖ missing heading: ## 期待効果\n${String(issue_template_section.section('## 期待効果'))}`,
		)
		expect(report).toHaveBeenCalledWith(expect.stringContaining('\n- 効く率: <値>\n'))
	})

	it('accepts it with the section and labels it an enhancement', async () => {
		const report = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await lint_body(`${SHORTENING_BODY}${EXPECTED_EFFECT_SECTION}`)).toBe(0)
		expect(report).toHaveBeenCalledWith(ENHANCEMENT_OUTPUT)
	})
})

function declaring(line: string): string {
	return `${VALID_BODY}- 種別: 非不具合\n${line}\n${REQUIRED_SECTIONS}`
}

describe('issue:lint measurement declaration (joshuafolkken/kit#4621)', () => {
	it('rejects a malformed declaration', async () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await lint_body(declaring('- 計測宣言: echo 3 under 5'))).toBe(1)
		expect(report).toHaveBeenCalledWith(expect.stringContaining('計測宣言'))
	})

	it('accepts a well-formed one', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await lint_body(declaring('- 計測宣言: `echo 3` <= 5'))).toBe(0)
	})
})

describe('issue:lint figure sources (joshuafolkken/kit#7021)', () => {
	it('warns about a figure with no source and still passes', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(await lint_body(declaring('概算は約 35 分 / 100 行'))).toBe(0)
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^⚠ number with no source .*約 35 分/u))
	})

	it('does not warn about a figure with its command', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		await lint_body(declaring('中央値 16.9 分（`pnpm josh lane:stats --period 3`）'))

		expect(warn).not.toHaveBeenCalled()
	})
})

describe('issue:lint decision rule (joshuafolkken/kit#6501)', () => {
	const RULE = '- 判定規則: 検出範囲を保てるなら A、そうでなければ B（#6403）'

	it('rejects human judgement when a decision rule cites a measurement Issue', async () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await lint_body(declaring(`- 人の判断: 要（方針の判断）\n${RULE}`))).toBe(1)
		expect(report).toHaveBeenCalledWith(expect.stringContaining('- 人の判断: 不要'))
	})

	it.each([`- 人の判断: 不要\n${RULE}`, '- 人の判断: 要（方針の判断）'])(
		'accepts a consistent declaration: %s',
		async (line) => {
			vi.spyOn(console, 'info').mockImplementation(() => undefined)

			expect(await lint_body(declaring(line))).toBe(0)
		},
	)
})

const AGGREGATION_BODY = `${VALID_BODY.replace('1 ファイル', '6 ファイル')}- 種別: 非不具合\n${REQUIRED_SECTIONS}\n- [ ] 形を集計し Issue にコメントで記録する\n`

describe('issue:lint aggregation split (joshuafolkken/kit#5190)', () => {
	it('rejects an aggregation-comment criterion beside an implementation estimate', async () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await lint_body(AGGREGATION_BODY)).toBe(1)
		expect(report).toHaveBeenCalledWith(expect.stringContaining('--route split'))
	})
})
