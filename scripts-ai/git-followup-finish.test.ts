import { beforeEach, describe, expect, it, vi } from 'vitest'

// The run's tail, tested against the module that owns it rather than through the entry point
// (joshuafolkken/kit#1539). `git-followup-workflow.ts` runs `main()` at import time, so every case
// there paid for a full parse; this module has no such side effect, which is half the reason the tail
// was moved out of it.
const PENDING_SENTINEL = vi.hoisted(() => 'pending-release-line-sentinel')
const WORKTREE_DIRECTORY = vi.hoisted(() => '/scratch/.git')
const NEXT_ISSUES_HEADER = '🗒 Next issues (newest first):'

const release_hold_mock = vi.hoisted(() => vi.fn())
const worktree_directory_mock = vi.hoisted(() =>
	vi.fn<() => Promise<string | undefined>>().mockResolvedValue(WORKTREE_DIRECTORY),
)
const record_run_mock = vi.hoisted(() =>
	vi.fn<() => Promise<Array<string>>>().mockResolvedValue([]),
)
const clear_round_one_mock = vi.hoisted(() => vi.fn())
const attest_clear_mock = vi.hoisted(() => vi.fn(async () => undefined))

// The sentinel is set in `beforeEach` rather than here: a hoisted factory cannot read a constant
// declared below it, and repeating the string would be two spellings of one value.
const pending_release_mock = vi.hoisted(() =>
	vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined),
)

vi.mock('../scripts/git/git-followup-pending', () => ({
	git_followup_pending: { pending_release_line: pending_release_mock },
}))

vi.mock('../scripts/git/git-next-issues', () => ({
	git_next_issues: {
		fetch_next_issue_lines: vi.fn<() => Promise<Array<string>>>().mockResolvedValue([]),
	},
}))

vi.mock('../scripts/review/review-stamps', () => ({
	review_stamps: { clear_round_one: clear_round_one_mock },
}))

vi.mock('../scripts/review/review-attest', () => ({
	review_attest: { clear_here: attest_clear_mock },
}))

vi.mock('../scripts/time/time-history', () => ({
	time_history: { record_run: record_run_mock },
}))

vi.mock('../scripts/run/run-hold', () => ({
	run_hold: {
		hold_path: (directory: string) => `${directory}/hold.json`,
		release_hold: release_hold_mock,
		worktree_directory: worktree_directory_mock,
	},
}))

const { git_next_issues } = await import('../scripts/git/git-next-issues')
const { git_followup_finish } = await import('./git-followup-finish')

const fetch_next_issue_lines_mock = vi.mocked(git_next_issues.fetch_next_issue_lines)

function silence_console(): void {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
	worktree_directory_mock.mockResolvedValue(WORKTREE_DIRECTORY)
	record_run_mock.mockResolvedValue([])
	fetch_next_issue_lines_mock.mockResolvedValue([])
	pending_release_mock.mockResolvedValue(PENDING_SENTINEL)
	silence_console()
})

// joshuafolkken/kit#1486: the line used to be `📦 project version: <v>`, read from the local
// `package.json`. Children no longer bump, so that number names the previous release rather than what
// the run ships, and the count of unreleased merges replaces it.
describe('print_pending_release', () => {
	it('logs whatever the pending-release module returned', async () => {
		await git_followup_finish.print_pending_release()

		expect(console.info).toHaveBeenCalledWith(PENDING_SENTINEL)
	})
})

describe('print_next_issues - output', () => {
	it('prints each returned line', async () => {
		const lines = [NEXT_ISSUES_HEADER, '  1. #9 Issue 9']

		fetch_next_issue_lines_mock.mockResolvedValueOnce(lines)
		await git_followup_finish.print_next_issues('42')

		expect(console.info).toHaveBeenNthCalledWith(1, lines[0])
		expect(console.info).toHaveBeenNthCalledWith(2, lines[1])
	})

	it('prints nothing when there are no lines', async () => {
		await git_followup_finish.print_next_issues(undefined)

		expect(console.info).not.toHaveBeenCalled()
	})
})

describe('print_next_issues - completed issue number', () => {
	it('passes the completed issue number as a number', async () => {
		await git_followup_finish.print_next_issues('42')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
	})

	// `--issue-number "#42"` is the shape the positional parser accepts, so the exclusion must
	// read it the same way rather than silently skipping it.
	it('accepts the #N shape', async () => {
		await git_followup_finish.print_next_issues('#42')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
	})

	it('passes undefined when no issue number is known', async () => {
		await git_followup_finish.print_next_issues(undefined)

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(undefined)
	})

	// Number('42a') is NaN, which compares unequal to every issue number and would silently
	// disable the just-completed-issue exclusion.
	it('passes undefined for a non-numeric issue number instead of NaN', async () => {
		await git_followup_finish.print_next_issues('42a')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(undefined)
	})
})

// The epic auto-close is gated on the merge for the same reason: on `--no-merge` the linked issue
// is still open and still the current task, so a "next" list would hide the one issue that matters.
describe('print_completion - merge gating', () => {
	it('lists next issues on a merged run', async () => {
		await git_followup_finish.print_completion('42', true)

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
	})

	it('skips the next-issues list on a --no-merge run', async () => {
		await git_followup_finish.print_completion('42', false)

		expect(fetch_next_issue_lines_mock).not.toHaveBeenCalled()
	})

	// The pending-release line is the documented final line of the console output.
	it('prints the unreleased merge count last', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([NEXT_ISSUES_HEADER])
		await git_followup_finish.print_completion('42', true)

		expect(vi.mocked(console.info).mock.calls.at(-1)?.[0]).toBe(PENDING_SENTINEL)
	})
})

// The round-1 review snapshot's lifetime is one run, and `--no-merge` is not the end of one: the pull
// request is still open, and a record removed there lets the next round-1 brief write a fresh one
// against the already-fixed tree — the arm-A skip joshuafolkken/kit#1441 closed, arriving from the
// other side.
describe('the review records are cleared only by a merged run', () => {
	it('clears both records when the run merged', async () => {
		await git_followup_finish.clear_review_records(true)

		expect(clear_round_one_mock).toHaveBeenCalledTimes(1)
		expect(attest_clear_mock).toHaveBeenCalledTimes(1)
	})

	it('leaves both records in place on a --no-merge run', async () => {
		await git_followup_finish.clear_review_records(false)

		expect(clear_round_one_mock).not.toHaveBeenCalled()
		expect(attest_clear_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#1471. The report is emitted by the run that finished rather than by a person
// typing `diag`, and "finished" is the merge — the same gate the round-1 clear above uses.
describe('the run report is emitted only by a merged run', () => {
	it('records the run that merged, against the checkout it ran in', async () => {
		await git_followup_finish.record_run_report('#42', true)

		expect(record_run_mock).toHaveBeenCalledWith(42, process.cwd())
	})

	it('records nothing on a --no-merge run', async () => {
		await git_followup_finish.record_run_report('#42', false)

		expect(record_run_mock).not.toHaveBeenCalled()
	})

	it('records nothing when no issue number was given', async () => {
		await git_followup_finish.record_run_report(undefined, true)

		expect(record_run_mock).not.toHaveBeenCalled()
	})

	it('prints every line the recorder returned', async () => {
		const heading = '📈 Run report — issue #42'

		record_run_mock.mockResolvedValueOnce([heading])
		await git_followup_finish.record_run_report('#42', true)

		expect(console.info).toHaveBeenCalledWith(heading)
	})
})

// joshuafolkken/kit#1091. The hold a typed entry point claims before it starts is released on the one
// seam every finished run passes through, so nothing has to remember to type the release command.
describe('the working-tree hold is released only by a merged run', () => {
	it('releases the hold on the work tree the run used', async () => {
		await git_followup_finish.release_worktree_hold(true)

		expect(release_hold_mock).toHaveBeenCalledWith(`${WORKTREE_DIRECTORY}/hold.json`)
	})

	it('keeps the hold on a --no-merge run', async () => {
		await git_followup_finish.release_worktree_hold(false)

		expect(release_hold_mock).not.toHaveBeenCalled()
	})

	it('reports success when the work tree could not be read', async () => {
		worktree_directory_mock.mockRejectedValueOnce(new Error('not a git repository'))

		await expect(git_followup_finish.release_worktree_hold(true)).resolves.toBeUndefined()
		expect(release_hold_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#1539. The tail used to be four bare statements, so whichever of them threw first
// discarded the ones after it — and the hold release is the last. Three merged runs (#1197, #1537,
// #1319) ended exactly that way, leaving the checkout locked for the next run.
describe('finish — one failing step does not discard the rest', () => {
	const FAILURE = new Error('ENOSPC: no space left on device')

	it('releases the hold even when the run report throws', async () => {
		record_run_mock.mockRejectedValueOnce(FAILURE)

		await git_followup_finish.finish('#42', true)

		expect(release_hold_mock).toHaveBeenCalledWith(`${WORKTREE_DIRECTORY}/hold.json`)
	})

	it('does not reject, so a merged run is not reported as a failed one', async () => {
		record_run_mock.mockRejectedValueOnce(FAILURE)

		await expect(git_followup_finish.finish('#42', true)).resolves.toBe(false)
	})

	it('names the step that failed rather than passing silently', async () => {
		record_run_mock.mockRejectedValueOnce(FAILURE)

		await git_followup_finish.finish('#42', true)

		const warned = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))

		expect(warned.join('\n')).toContain('The run report')
	})

	it('releases the hold even when the completion output throws', async () => {
		fetch_next_issue_lines_mock.mockRejectedValueOnce(FAILURE)

		await git_followup_finish.finish('#42', true)

		expect(release_hold_mock).toHaveBeenCalledWith(`${WORKTREE_DIRECTORY}/hold.json`)
	})

	it('answers true when the whole tail completed', async () => {
		await expect(git_followup_finish.finish('#42', true)).resolves.toBe(true)
	})

	it('keeps the hold when the run merged nothing', async () => {
		await git_followup_finish.finish('#42', false)

		expect(release_hold_mock).not.toHaveBeenCalled()
	})

	// The guard is what the merge earned: a `--no-merge` run has merged nothing, so a failure in its
	// tail is a failure of the run and still ends it — reporting it as cleanup "after the merge" would
	// describe a merge that never happened.
	it('rejects on a --no-merge run, whose tail failure is a failure of the run', async () => {
		pending_release_mock.mockRejectedValueOnce(FAILURE)

		await expect(git_followup_finish.finish('#42', false)).rejects.toThrow(FAILURE)
	})
})
