import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_lint_cli } from './issue-lint-cli'

// joshuafolkken/kit#9148: `issue:lint` refuses a malformed adopt-branch row and passes a well-formed one.

const make_directory = temporary_directory()
const BODY = [
	'## 概要',
	'',
	'要約',
	'',
	'## 背景',
	'',
	'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
	'- 種別: 非不具合',
	'',
	'## 現象',
	'',
	'## 期待結果',
	'',
	'## 受け入れ条件',
	'',
].join('\n')

async function lint_with(row: string): Promise<number> {
	const body_path = path.join(make_directory('issue-lint-adopt-'), 'issue.md')

	await writeFile(body_path, `${BODY}\n${row}\n`)

	return await issue_lint_cli.run(body_path)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue:lint adopt-branch row', () => {
	it('refuses a row without its sha', async () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await lint_with('- 取り込むブランチ: wip/x')).toBe(1)
		expect(report).toHaveBeenCalledWith(expect.stringContaining('取り込むブランチ'))
	})

	it('passes a well-formed row', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await lint_with('- 取り込むブランチ: wip/x @ abc1234')).toBe(0)
	})
})
