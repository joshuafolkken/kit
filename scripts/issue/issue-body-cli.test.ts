import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { trusted_measure } from '#scripts/issue/trusted-measure'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_body_cli } from './issue-body-cli'

type BodyRead = { kind: 'read'; text: string | undefined } | { kind: 'missing' }

const { issue_edit_body, issue_get_body_classified } = vi.hoisted(() => ({
	issue_edit_body: vi.fn<(issue: string, body: string) => Promise<string>>(),
	issue_get_body_classified: vi.fn<(issue: string) => Promise<BodyRead>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_edit_body, issue_get_body_classified },
}))
// An unread issue is an untrusted one; a test that needs a trusted body spies `read_trusted_body`.
vi.mock('#scripts/issue/trusted-measure-source', () => ({
	trusted_measure_source: { read: vi.fn().mockResolvedValue(undefined) },
}))

const make_directory = temporary_directory()
const ISSUE = '7002'
const BODY_FILE = '--body-file'
const URL = 'https://github.com/o/r/issues/7002'
const VALID_BODY =
	'## 背景\n\n- 種別: 不具合\n- 原因: #4201\n- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）\n\n## 現象\n\n## 期待結果\n\n## 受け入れ条件\n'
const INVALID_BODY = '## 背景\n\nno template\n'
const PREMISED_BODY =
	'## 背景\n\n- 種別: 不具合\n- 原因: #4201\n- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）\n- 前提: `pnpm josh lane:stats --period 3` >= 3\n\n## 現象\n\n## 期待結果\n\n## 受け入れ条件\n'
const TABLE_ROW = { kind: 'ok', output: '| 89 | 1.0 |' } as const
const EPIC_BODY = '## Split rationale\n\nwhy\n\n## Progress\n\n- [ ] #1\n'

async function body_file(body: string): Promise<string> {
	const body_path = path.join(make_directory('issue-body-'), 'body.md')

	await writeFile(body_path, body)

	return body_path
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	issue_edit_body.mockResolvedValue(URL)
	issue_get_body_classified.mockResolvedValue({ kind: 'read', text: 'old body' })
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

	it('passes dispatcher arguments through the executable entry', async () => {
		const body_path = await body_file(VALID_BODY)

		expect(
			await main_entry_fixture.run_entry('scripts/issue/issue-body-cli.ts', [
				ISSUE,
				BODY_FILE,
				body_path,
			]),
		).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, VALID_BODY)
	})
})

describe('issue_body_cli.run publication record', () => {
	it('keeps an unpublished child publication record the new body lacks (ac-16bd1e9e)', async () => {
		const body_path = await body_file(VALID_BODY)

		const text = issue_publication_state.prepare('old body', ['auto-ok'])

		issue_get_body_classified.mockResolvedValue({ kind: 'read', text })

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(0)
		expect(issue_get_body_classified).toHaveBeenCalledExactlyOnceWith(ISSUE)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(
			ISSUE,
			`${VALID_BODY.trimEnd()}\n\n<!-- josh:publication {"labels":["auto-ok"]} -->\n`,
		)
	})

	it('writes the file as is over a body with no publication record (ac-ec0b8d38)', async () => {
		const body_path = await body_file(VALID_BODY)

		issue_get_body_classified.mockResolvedValue({ kind: 'read', text: VALID_BODY })

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, VALID_BODY)
	})

	it('refuses to write when the current body cannot be read', async () => {
		const body_path = await body_file(VALID_BODY)

		issue_get_body_classified.mockResolvedValue({ kind: 'missing' })

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Cannot read'))
	})
})

describe('issue_body_cli.run body kinds', () => {
	it('writes an epic body, which the issue template does not judge', async () => {
		const body_path = await body_file(EPIC_BODY)

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(0)
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, EPIC_BODY)
	})

	it('warns about a background figure with no source and still writes the body', async () => {
		const body = VALID_BODY.replace('## 現象', '中央値 約 35 分\n\n## 現象')
		const body_path = await body_file(body)

		vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(0)
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringMatching(/^⚠ number with no source .*約 35 分/u),
		)
	})
})

describe('issue_body_cli.run refusals', () => {
	it('refuses a body the lint rejects without writing it (ac-19a42725)', async () => {
		const body_path = await body_file(INVALID_BODY)

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('✖ missing heading: '))
	})

	it('refuses a body file it cannot read without writing', async () => {
		const missing = path.join(make_directory('issue-body-missing-'), 'absent.md')

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, missing])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
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

// joshuafolkken/kit#7769: a body piped back from the current one carries its author's premises.
describe('issue_body_cli.run premises', () => {
	it('refuses a premise whose last output line is not a number (ac-b6861606)', async () => {
		const body_path = await body_file(PREMISED_BODY)

		vi.spyOn(trusted_measure, 'run_command').mockReturnValue(TABLE_ROW)

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('lane:value cell'))
	})

	it('never runs a premise an outside author already wrote in the current body', async () => {
		const body_path = await body_file(PREMISED_BODY)
		const run = vi.spyOn(trusted_measure, 'run_command')

		issue_get_body_classified.mockResolvedValue({ kind: 'read', text: PREMISED_BODY })

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(0)
		expect(run).not.toHaveBeenCalled()
		expect(issue_edit_body).toHaveBeenCalledExactlyOnceWith(ISSUE, PREMISED_BODY)
	})

	it('runs a premise already in the current body when its author and editor are trusted', async () => {
		const body_path = await body_file(PREMISED_BODY)

		issue_get_body_classified.mockResolvedValue({ kind: 'read', text: PREMISED_BODY })
		vi.spyOn(trusted_measure, 'read_trusted_body').mockResolvedValue(
			trusted_measure.drafted(PREMISED_BODY),
		)
		vi.spyOn(trusted_measure, 'run_command').mockReturnValue(TABLE_ROW)

		expect(await issue_body_cli.run([ISSUE, BODY_FILE, body_path])).toBe(1)
		expect(issue_edit_body).not.toHaveBeenCalled()
	})
})
