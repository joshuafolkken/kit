import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_scout_cli } from './issue-scout-cli'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

const PATH = 'draft.md'
const TITLE = 'Add one acceptance criterion'
const BODY = '## 目的\n\n追加目的\n\n## 受け入れ条件\n\n- [ ] 検証可能'
const BODY_FILE_OPTION = '--body-file'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_scout_cli draft body', () => {
	it('accepts a complete draft from a file', async () => {
		vi.mocked(readFile).mockResolvedValue(BODY)
		const args = issue_scout_cli.read_arguments([TITLE, BODY_FILE_OPTION, PATH])

		expect(args).toBeDefined()
		if (args === undefined) return
		const resolved = await issue_scout_cli.with_draft_body(args)

		expect(resolved?.body).toBe(BODY)
	})

	it('refuses a failed body read instead of scanning an empty draft', async () => {
		vi.mocked(readFile).mockRejectedValue(new Error('unreadable'))
		const args = issue_scout_cli.read_arguments([TITLE, BODY_FILE_OPTION, PATH])

		expect(args).toBeDefined()
		if (args === undefined) return
		expect(await issue_scout_cli.with_draft_body(args)).toBeUndefined()
	})

	it('refuses two competing body inputs', () => {
		expect(
			issue_scout_cli.read_arguments([TITLE, '--body', BODY, BODY_FILE_OPTION, PATH]),
		).toBeUndefined()
	})
})
