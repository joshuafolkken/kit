import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { defect_origin_cli } from './defect-origin-cli'
import { issue_read_cli } from './issue-read-cli'

const FIELD = '\u{1F}'
const RECORD = '\u{1E}'
const TARGET = 'run-board.ts'
const MERGE_LOG = `2026-10-20T10:00:00+07:00${FIELD}Merge pull request #4201 from joshuafolkken/x-lane${FIELD}Draw the board${RECORD}\n`

function stub_issue(): void {
	vi.spyOn(issue_read_cli, 'read_block').mockResolvedValue({
		kind: 'ok',
		block: `The board breaks in \`${TARGET}\`.`,
	})
	vi.spyOn(git_gh_command, 'issue_view_json_classified').mockResolvedValue({
		kind: 'read',
		json: '{"createdAt":"2026-10-21T00:00:00Z"}',
	})
}

function printed(spy: MockInstance<(message: unknown) => void>): string {
	return spy.mock.calls.map(([message]) => String(message)).join('\n')
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('defect:origin command', () => {
	it('refuses anything but one issue number', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await expect(defect_origin_cli.run([])).resolves.toBe(1)
		expect(printed(error)).toContain(defect_origin_cli.USAGE)
	})

	it('lists the merge that changed a path the issue names', async () => {
		stub_issue()
		vi.spyOn(git_spawn, 'read').mockResolvedValue(MERGE_LOG)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await expect(defect_origin_cli.run(['4241'])).resolves.toBe(0)
		expect(printed(info)).toMatch(/#4201\]?.*2026-10-20 {2}Draw the board/u)
	})

	it('names a target git could not search instead of passing it for one no merge touched', async () => {
		stub_issue()
		vi.spyOn(git_spawn, 'read').mockRejectedValue(new Error('fatal: bad pathspec'))
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await expect(defect_origin_cli.run(['4241'])).resolves.toBe(0)
		expect(printed(error)).toContain(`Could not search the merge history for ${TARGET}`)
	})
})
