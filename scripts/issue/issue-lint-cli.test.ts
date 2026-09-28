import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_lint_cli } from './issue-lint-cli'

const TEMP_PATHS: Array<string> = []
const VALID_BODY = '## 背景\n\n'
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
		{ body: `${VALID_BODY}- 種別: 不具合\n`, expected: 'labels: bug' },
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

describe('issue:lint fenced headings', () => {
	it('rejects required headings that appear only inside a fenced example', async () => {
		const directory = mkdtempSync(path.join(tmpdir(), 'issue-lint-fenced-heading-'))

		TEMP_PATHS.push(directory)
		const body_path = path.join(directory, 'issue.md')

		await writeFile(body_path, `\`\`\`md\n## 背景\n- 種別: 不具合\n\`\`\`\n${REQUIRED_SECTIONS}`)
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_lint_cli.run(body_path)).toBe(1)
		expect(report).toHaveBeenCalledWith('✖ missing heading: ## 背景\n✖ missing bug classification')
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
			`${VALID_BODY}- 種別: 不具合\n- 目的: 機能改善\n${REQUIRED_SECTIONS}`,
		)
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await issue_lint_cli.run(body_path)).toBe(1)
		expect(report).toHaveBeenCalledWith('✖ bug and enhancement declarations cannot be combined')
	})
})
