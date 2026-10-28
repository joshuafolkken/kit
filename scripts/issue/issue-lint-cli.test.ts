import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_lint_cli } from './issue-lint-cli'
import { issue_template_section } from './issue-template-section'

const TEMP_PATHS: Array<string> = []
const VALID_BODY = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）\n'
const REQUIRED_SECTIONS = '## 現象\n\n## 期待結果\n\n## 受け入れ条件\n'
const ENHANCEMENT_OUTPUT = 'labels: enhancement'

afterEach(async () => {
	vi.restoreAllMocks()
	await Promise.all(
		TEMP_PATHS.splice(0).map(async (directory) => {
			await rm(directory, { recursive: true })
		}),
	)
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
		const directory = mkdtempSync(path.join(tmpdir(), 'issue-lint-label-'))

		TEMP_PATHS.push(directory)
		const body_path = path.join(directory, 'issue.md')

		await writeFile(body_path, `${body}${REQUIRED_SECTIONS}`)
		const report = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_lint_cli.run(body_path)).toBe(0)
		expect(report).toHaveBeenCalledWith(expected)
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

describe('issue:lint fenced headings', () => {
	it('rejects required headings that appear only inside a fenced example', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'issue-lint-fenced-heading-'))

		TEMP_PATHS.push(directory)
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
		const directory = mkdtempSync(path.join(tmpdir(), 'issue-lint-unclassified-'))

		TEMP_PATHS.push(directory)
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
		const directory = mkdtempSync(path.join(tmpdir(), 'issue-lint-conflict-'))

		TEMP_PATHS.push(directory)
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
	const directory = mkdtempSync(path.join(tmpdir(), 'issue-lint-expected-effect-'))

	TEMP_PATHS.push(directory)
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

const AGGREGATION_BODY = `${VALID_BODY.replace('1 ファイル', '6 ファイル')}- 種別: 非不具合\n${REQUIRED_SECTIONS}\n- [ ] 形を集計し Issue にコメントで記録する\n`

describe('issue:lint aggregation split (joshuafolkken/kit#5190)', () => {
	it('rejects an aggregation-comment criterion beside an implementation estimate', async () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await lint_body(AGGREGATION_BODY)).toBe(1)
		expect(report).toHaveBeenCalledWith(expect.stringContaining('--route split'))
	})
})
