import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_body_cli } from './issue-body-cli'

const { issue_edit_body } = vi.hoisted(() => ({
	issue_edit_body: vi.fn<(issue: string, body: string) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({ git_gh_command: { issue_edit_body } }))

const make_directory = temporary_directory()
const ISSUE = '7002'
const BODY_FILE = '--body-file'
const URL = 'https://github.com/o/r/issues/7002'
const VALID_BODY =
	'## 背景\n\n- 種別: 不具合\n- 原因: #4201\n- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）\n\n## 現象\n\n## 期待結果\n\n## 受け入れ条件\n'
const INVALID_BODY = '## 背景\n\nno template\n'

async function body_file(body: string): Promise<string> {
	const body_path = path.join(make_directory('issue-body-'), 'body.md')

	await writeFile(body_path, body)

	return body_path
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	issue_edit_body.mockResolvedValue(URL)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('issue_body_cli.run', () => {
	it('replaces the body with a file that passes the lint (ac-19a42725)', async () => {
		const body_path = await body_file(VALID_BODY)

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, VALID_BODY)
		expect(console.info).toHaveBeenCalledWith(URL)
	})

	it('refuses a body the lint rejects without writing it (ac-19a42725)', async () => {
		const body_path = await body_file(INVALID_BODY)

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('✖ missing heading: '))
	})

	it.each(
		[[], [ISSUE], [BODY_FILE, 'x.md'], ['0', BODY_FILE, 'x.md'], [ISSUE, '--bogus']].map(
			(args) => ({ args }),
		),
	)('refuses invalid arguments $args without writing', async ({ args }) => {
		expect(await issue_body_cli.run(args)).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('josh issue:body'))
	})
})
