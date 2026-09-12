import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelegramSendInput } from '../scripts/git/telegram-notify'
import type { RunRecordOutcome } from '../scripts/time/time-history'

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
const MISSING_TRANSCRIPT = 'no session record for issue #42'
const RECORDED = vi.hoisted(() => ({ is_recorded: true, lines: [] }))
const record_run_mock = vi.hoisted(() =>
	vi.fn<() => Promise<{ is_recorded: boolean; lines: Array<string>; reason?: string }>>(),
)
const send_or_report_mock = vi.hoisted(() =>
	vi.fn<(input: TelegramSendInput, recovery: string | undefined) => Promise<boolean>>(),
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

vi.mock('../scripts/git/telegram-notify', () => ({
	telegram_notify: { send_or_report: send_or_report_mock },
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

// A real linked work tree rather than a stub: the property under test is that `record_run_report`
// hands the lane's own directory through unchanged, so the behavior is pinned rather than the call
// shape. A lane's `.git` is a *file* holding `gitdir: <main>/.git/worktrees/<name>` — this builds that.
function make_lane_worktree(): { directory: string; main: string } {
	const main = mkdtempSync(path.join(tmpdir(), 'followup-main-'))
	const directory = mkdtempSync(path.join(tmpdir(), 'followup-lane-'))

	writeFileSync(path.join(directory, '.git'), `gitdir: ${main}/.git/worktrees/1628\n`, 'utf8')

	return { directory, main }
}

function not_recorded(reason: string): RunRecordOutcome {
	return { is_recorded: false, lines: [], reason }
}

function silence_console(): void {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
	worktree_directory_mock.mockResolvedValue(WORKTREE_DIRECTORY)
	record_run_mock.mockResolvedValue(RECORDED)
	send_or_report_mock.mockResolvedValue(true)
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

	// joshuafolkken/kit#1825. `record_run` is handed the raw work tree the run happened in: a dispatched
	// lane child's transcript is filed under the lane's own slug (joshuafolkken/kit#1749), so the lookup
	// must start there. `record_run` resolves the durable history root itself, so pre-rewriting to
	// `session_cwd` here — as joshuafolkken/kit#1628 did, before the child was a separate process — is
	// what hid every lane child's transcript by looking only in the main slug.
	it('hands record_run the raw lane work tree, not the rewritten main checkout', async () => {
		const lane = make_lane_worktree()

		await git_followup_finish.record_run_report('#42', true, lane.directory)

		expect(record_run_mock).toHaveBeenCalledWith(42, lane.directory)
		expect(record_run_mock).not.toHaveBeenCalledWith(42, lane.main)
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

		record_run_mock.mockResolvedValueOnce({ is_recorded: true, lines: [heading] })
		await git_followup_finish.record_run_report('#42', true)

		expect(console.info).toHaveBeenCalledWith(heading)
	})
})

// joshuafolkken/kit#1628. The printed line has been there since joshuafolkken/kit#1471 and thirteen
// runs still lost their record unnoticed, so the fact also goes where the user actually looks. It may
// never fail the run: the merge already happened.
describe('a record that was not written reaches the completion notification', () => {
	it('warns rather than reporting a failure, and names what would measure it', async () => {
		record_run_mock.mockResolvedValueOnce(not_recorded(MISSING_TRANSCRIPT))
		await git_followup_finish.record_run_report('#42', true)

		const [call] = send_or_report_mock.mock.calls

		expect(call?.[0].task_type).toBe('warning')
		expect(call?.[0].body).toContain(MISSING_TRANSCRIPT)
		expect(call?.[0].body).toContain('pnpm josh time --issue 42')
	})

	// `JOSH_TIME_HISTORY=0` is an answer, not a gap: `record_run` returns unrecorded with no reason,
	// and warning once per merge about an opted-out feature is how a warning channel stops being read.
	it('says nothing when the history was switched off', async () => {
		record_run_mock.mockResolvedValueOnce({ is_recorded: false, lines: [] })
		await git_followup_finish.record_run_report('#42', true)

		expect(send_or_report_mock).not.toHaveBeenCalled()
	})

	// Nothing rewrites a missing line into the file, so the message must not offer a recovery that
	// only reads. `send_or_report`'s own recovery line is for a failed *send*, which nothing re-sends.
	it('says the run is permanently absent rather than offering to restore it', async () => {
		record_run_mock.mockResolvedValueOnce(not_recorded(MISSING_TRANSCRIPT))
		await git_followup_finish.record_run_report('#42', true)

		const [call] = send_or_report_mock.mock.calls

		expect(call?.[0].body).toContain('permanently absent')
		expect(call?.[1]).toBeUndefined()
	})

	it('says nothing when the record landed', async () => {
		await git_followup_finish.record_run_report('#42', true)

		expect(send_or_report_mock).not.toHaveBeenCalled()
	})

	it('carries on when the warning itself could not be sent', async () => {
		record_run_mock.mockResolvedValueOnce(not_recorded('unwritable history'))
		send_or_report_mock.mockResolvedValueOnce(false)

		await expect(git_followup_finish.record_run_report('#42', true)).resolves.toBeUndefined()
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

	// joshuafolkken/kit#1799: a release names the run it belongs to, so a person finishing this step
	// by hand is releasing a record they did not write. The plain spelling answers `held` and removes
	// nothing there — a printed recovery that cannot recover, which is the failure this step's whole
	// `recovery` field exists to avoid.
	it('offers a recovery a person other than the run can actually run', () => {
		const steps = git_followup_finish.build_finish_steps('#42', true)
		const hold = steps.find((step) => step.label === 'The working-tree hold release')

		expect(hold?.recovery).toBe('pnpm josh run:release --force')
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
