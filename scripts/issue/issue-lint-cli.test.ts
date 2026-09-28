import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_lint_cli } from './issue-lint-cli'

const TEMP_PATHS: Array<string> = []
const VALID_BODY = '## 背景\n\n## 現象\n\n## 期待結果\n\n## 受け入れ条件\n'

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
		{ body: VALID_BODY, expected: 'labels: none' },
	])('prints $expected for the issue body', async ({ body, expected }) => {
		const directory = mkdtempSync(path.join(tmpdir(), 'issue-lint-label-'))

		TEMP_PATHS.push(directory)
		const body_path = path.join(directory, 'issue.md')

		await writeFile(body_path, body)
		const report = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await issue_lint_cli.run(body_path)).toBe(0)
		expect(report).toHaveBeenCalledWith(expected)
	})
})
