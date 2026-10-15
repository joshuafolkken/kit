import { git_command } from '#scripts/git/git-command'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_ack_cli } from './issue-ack-cli'
import { issue_watch, type WatchRecord } from './issue-watch'
import { session_cite } from './session-cite'

// joshuafolkken/kit#3773: `josh issue:ack <N>` records that the run read a person's update. It must
// print exactly what it acknowledges, and refuse a number that is not the watched issue's, so an
// acknowledgement typed for one issue cannot clear the watch on another.

const ROOT = '/checkout'
const ISSUE = '3773'
const OTHER_ISSUE = '42'
const DIFF = 'Body edited:\n+ a new criterion'
const SUCCESS = 0
const FAILURE = 1
const NOTHING_ACKNOWLEDGED = 'nothing was acknowledged'
const TIME = '2026-10-14T00:00:00.000Z'

function capture(): { info: Array<string>; error: Array<string> } {
	const info: Array<string> = []
	const error: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation((message: string) => {
		info.push(message)
	})
	vi.spyOn(console, 'error').mockImplementation((message: string) => {
		error.push(message)
	})

	return { info, error }
}

function watched(issue: string): WatchRecord {
	return { issue, body: '', last_comment_id: 0, acknowledged_at: TIME, checked_at: TIME }
}

beforeEach(() => {
	vi.spyOn(git_command, 'repository_root').mockResolvedValue(ROOT)
	vi.spyOn(issue_watch, 'read_record').mockReturnValue(watched(ISSUE))
	vi.spyOn(issue_watch, 'acknowledge').mockResolvedValue({ issue: ISSUE, diff: DIFF })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_ack_cli.run — refusals', () => {
	it.each([[[]], [['abc']], [['0']], [[ISSUE, OTHER_ISSUE]]])(
		'prints the usage for argv %j',
		async (argv: ReadonlyArray<string>) => {
			const output = capture()

			await expect(issue_ack_cli.run(argv)).resolves.toBe(FAILURE)
			expect(output.error[0]).toContain('Usage: josh issue:ack')
			expect(issue_watch.acknowledge).not.toHaveBeenCalled()
		},
	)

	it('refuses a number that is not the watched issue', async () => {
		const output = capture()

		await expect(issue_ack_cli.run([OTHER_ISSUE])).resolves.toBe(FAILURE)
		expect(output.error[0]).toContain(NOTHING_ACKNOWLEDGED)
		expect(issue_watch.acknowledge).not.toHaveBeenCalled()
	})

	it('refuses when no baseline was recorded', async () => {
		capture()
		vi.mocked(issue_watch.read_record).mockReturnValue(undefined)

		await expect(issue_ack_cli.run([ISSUE])).resolves.toBe(FAILURE)
	})

	it('refuses when the issue could not be read', async () => {
		const output = capture()

		vi.mocked(issue_watch.acknowledge).mockResolvedValue(undefined)

		await expect(issue_ack_cli.run([ISSUE])).resolves.toBe(FAILURE)
		expect(output.error[0]).toContain(NOTHING_ACKNOWLEDGED)
	})
})

describe('issue_ack_cli.run — acknowledgement', () => {
	it('prints the acknowledged diff and exits 0', async () => {
		const output = capture()

		await expect(issue_ack_cli.run([ISSUE])).resolves.toBe(SUCCESS)
		expect(output.info).toStrictEqual([
			`Acknowledged issue ${session_cite.issue(ISSUE)}.\n\n${DIFF}`,
		])
		expect(issue_watch.acknowledge).toHaveBeenCalledWith(ROOT)
	})

	it('says nothing new when no person updated the issue', async () => {
		const output = capture()

		vi.mocked(issue_watch.acknowledge).mockResolvedValue({ issue: ISSUE, diff: undefined })

		await expect(issue_ack_cli.run([ISSUE])).resolves.toBe(SUCCESS)
		expect(output.info[0]).toBe(
			`Acknowledged issue ${session_cite.issue(ISSUE)}. No person has updated the issue since the run last read it.`,
		)
	})
})
