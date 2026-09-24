import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry_stash } from './run-carry-stash'

// joshuafolkken/kit#2505: `run:carry --end` reports the stashes whose issue has closed. The stack and
// the issue reads are mocked, so what is pinned is which entries reach the report and that a failed
// read never throws out of `--end`.

vi.mock('#scripts/git/git-stash', () => ({ git_stash: { list: vi.fn() } }))
vi.mock('#scripts/issue/issue-state-cli', () => ({ issue_state_cli: { read_issue: vi.fn() } }))

const { git_stash } = await import('#scripts/git/git-stash')
const { issue_state_cli } = await import('#scripts/issue/issue-state-cli')
const list = vi.mocked(git_stash.list)
const read_issue = vi.mocked(issue_state_cli.read_issue)

const STATES = new Map([
	['2370', 'CLOSED'],
	['2346', 'CLOSED'],
	['2505', 'OPEN'],
])

function printed(): string {
	return vi
		.mocked(console.error)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(console.error).mockClear()
	read_issue.mockImplementation(async (issue: string) => {
		const state = STATES.get(issue)

		if (state === undefined) return { kind: 'missing' }

		return { kind: 'state', state: { state, labels: [], is_human_review: false } }
	})
})

describe('run_carry_stash.report_orphans — closed-issue stashes at the end of a batch', () => {
	it('reports the closed issues and leaves the open one out', async () => {
		list.mockResolvedValue([
			{ selector: 'stash@{0}', subject: 'On main: 2505: uncommitted work at close' },
			{ selector: 'stash@{1}', subject: 'On main: 2370: opt-out version' },
			{ selector: 'stash@{2}', subject: 'On 2346-lane: 2346: setup-cut implementation' },
		])

		await run_carry_stash.report_orphans()

		expect(printed()).toContain('stash@{1}  #2370 closed')
		expect(printed()).toContain('stash@{2}  #2346 closed')
		expect(printed()).not.toContain('stash@{0}')
	})

	it('does not report an unreadable issue as closed, and says it could not read it', async () => {
		list.mockResolvedValue([{ selector: 'stash@{0}', subject: 'On main: 9999: gone' }])

		await run_carry_stash.report_orphans()

		expect(printed()).not.toContain('stash@{0}')
		expect(printed()).toContain('Could not read #9999')
		expect(printed()).toContain(run_carry_stash.FAILURE_NOTE)
	})

	it('prints nothing for an empty stack', async () => {
		list.mockResolvedValue([])

		await run_carry_stash.report_orphans()

		expect(console.error).not.toHaveBeenCalled()
	})

	it('prints a note instead of throwing when the stack cannot be read', async () => {
		list.mockRejectedValue(new Error('not a git repository'))

		await expect(run_carry_stash.report_orphans()).resolves.toBeUndefined()
		expect(printed()).toBe(run_carry_stash.FAILURE_NOTE)
	})
})
