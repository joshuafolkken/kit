import { beforeEach, describe, expect, it, vi } from 'vitest'

const RESOLVED_BRANCH = vi.hoisted(() => 'resolved-branch')
// Deliberately not the real line's shape. What these two cases can prove is the wiring — that
// whatever `pending_release_line` returns is what gets printed, and printed last. The line's own
// wording is pinned where it is built, in `scripts/git/git-followup-pending.test.ts`; asserting a
// realistic-looking string here would only prove the stub round-trips through `console.info`.
const PENDING_SENTINEL = vi.hoisted(() => 'pending-release-line-sentinel')

vi.mock('node:util', () => ({
	parseArgs: vi.fn().mockReturnValue({ values: {}, positionals: [] }),
}))

vi.mock('../scripts/git/git-pr-followup', () => ({
	git_pr_followup: { run: vi.fn<() => Promise<void>>().mockResolvedValue() },
}))

vi.mock('../scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('main') },
}))

vi.mock('../scripts/git/git-notify', () => ({
	git_notify: { build_notify_config: vi.fn<() => void>().mockReturnValue() },
}))

vi.mock('../scripts/git/git-next-issues', () => ({
	git_next_issues: {
		fetch_next_issue_lines: vi.fn<() => Promise<Array<string>>>().mockResolvedValue([]),
	},
}))

vi.mock('../scripts/git/git-error', () => ({
	git_error: { handle: vi.fn() },
}))

// **Mocked because the real one fetches the default branch** (joshuafolkken/kit#1486): the count has
// to come from main rather than from whatever branch is checked out, so resolving it touches the
// network. `main` runs at import time in this module, which would make every run of this suite do it.
vi.mock('../scripts/git/git-followup-pending', () => ({
	git_followup_pending: {
		pending_release_line: vi
			.fn<() => Promise<string | undefined>>()
			.mockResolvedValue(PENDING_SENTINEL),
	},
}))

// **Mocked because `main` runs at import time in this module, and the real removal would take the
// round-1 review snapshot of whatever run is executing this suite** — the trap joshuafolkken/kit#1437
// fixed for the gate's own records, one directory over (joshuafolkken/kit#1441). With the record gone,
// that run's next `josh review:brief` records a fresh one against its already-fixed tree and
// `josh review:round2` skips the round it owes.
vi.mock('../scripts/review/review-stamps', () => ({
	review_stamps: { clear_round_one: vi.fn() },
}))

// **Mocked for the same reason `review_stamps` above is, and for one more** (joshuafolkken/kit#1522):
// `main` runs at import time, so the real check would read — and the real clear would remove — the
// checkout-attestation record of whatever run is executing this suite. The real check would also
// *refuse*, because a suite is not a review: importing this module would then throw before a single
// case ran.
const NOT_REQUIRED = vi.hoisted(() => 'not-required')
const attest_check_mock = vi.hoisted(() => vi.fn(async () => ({ status: NOT_REQUIRED })))
const attest_clear_mock = vi.hoisted(() => vi.fn(async () => undefined))
const REFUSAL_SENTINEL = vi.hoisted(() => 'attestation-refusal-sentinel')

vi.mock('../scripts/review/review-attest', () => ({
	review_attest: {
		check_here: attest_check_mock,
		clear_here: attest_clear_mock,
		refusal_message: () => REFUSAL_SENTINEL,
	},
}))

// **Mocked for the same reason `review_stamps` above is**: `main` runs at import time, so the real
// recorder would measure — and append a record for — whatever run is executing this suite
// (joshuafolkken/kit#1471).
const record_run_mock = vi.hoisted(() =>
	vi.fn<() => Promise<Array<string>>>().mockResolvedValue([]),
)

vi.mock('../scripts/time/time-history', () => ({
	time_history: { record_run: record_run_mock },
}))

// **Mocked for the same reason the two above are**: `main` runs at import time, so a real release
// would clear the working-tree hold of whatever run is executing this suite — handing this checkout
// to a second run while this one is mid-flight, which is the incident joshuafolkken/kit#1091 exists
// to prevent.
const WORKTREE_DIRECTORY = vi.hoisted(() => '/scratch/.git')
const release_hold_mock = vi.hoisted(() => vi.fn())
const worktree_directory_mock = vi.hoisted(() =>
	vi.fn<() => Promise<string | undefined>>().mockResolvedValue(WORKTREE_DIRECTORY),
)

vi.mock('../scripts/run/run-hold', () => ({
	run_hold: {
		hold_path: (directory: string) => `${directory}/hold.json`,
		release_hold: release_hold_mock,
		worktree_directory: worktree_directory_mock,
	},
}))

const { git_followup_workflow } = await import('./git-followup-workflow')

describe('parse_issue_number_from_text', () => {
	it('returns undefined for undefined input', () => {
		expect(git_followup_workflow.parse_issue_number_from_text(undefined)).toBeUndefined()
	})

	it('returns undefined for empty string', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('')).toBeUndefined()
	})

	it('extracts number from "#42" format', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('#42')).toBe('42')
	})

	it('extracts number from bare digit string', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('42')).toBe('42')
	})

	it('extracts trailing issue number from title string', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('feat: fix bug #42')).toBe('42')
	})

	it('returns undefined when input has no issue number', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('no number here')).toBeUndefined()
	})

	it('trims whitespace before extracting', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('  #42  ')).toBe('42')
	})
})

describe('is_merge_resolved', () => {
	it('returns true when no flags are set', () => {
		expect(git_followup_workflow.is_merge_resolved({})).toBe(true)
	})

	it('returns false when --no-merge is set', () => {
		expect(git_followup_workflow.is_merge_resolved({ 'no-merge': true })).toBe(false)
	})

	it('returns true when --merge is set without --no-merge (backward compat)', () => {
		expect(git_followup_workflow.is_merge_resolved({ merge: true })).toBe(true)
	})

	it('returns false when both --merge and --no-merge are set (--no-merge wins)', () => {
		expect(git_followup_workflow.is_merge_resolved({ merge: true, 'no-merge': true })).toBe(false)
	})
})

// joshuafolkken/kit#1486: the line used to be `📦 project version: <v>`, read from the local
// `package.json`. Children no longer bump, so that number names the previous release rather than what
// the run ships, and the count of unreleased merges replaces it. What is asserted here is the wiring
// — the line the run prints is the one `git_followup_pending` built.
describe('print_pending_release', () => {
	it('logs whatever the pending-release module returned', async () => {
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_pending_release()
			expect(spy).toHaveBeenCalledWith(PENDING_SENTINEL)
		} finally {
			spy.mockRestore()
		}
	})
})

const { git_next_issues } = await import('../scripts/git/git-next-issues')
const fetch_next_issue_lines_mock = vi.mocked(git_next_issues.fetch_next_issue_lines)

const NEXT_ISSUES_HEADER = '🗒 Next issues (newest first):'

// Importing the module runs `main()` (parseArgs is mocked to an empty parse), which already calls
// the mock once. Without this every `toHaveBeenCalledWith` would match that call instead of the
// one the test made, and an inverted gate or a broken parser would still pass.
beforeEach(() => {
	fetch_next_issue_lines_mock.mockClear()
})

describe('print_next_issues - output', () => {
	it('prints each returned line', async () => {
		const lines = [NEXT_ISSUES_HEADER, '  1. #9 Issue 9']

		fetch_next_issue_lines_mock.mockResolvedValueOnce(lines)
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_next_issues('42')
			expect(spy).toHaveBeenCalledTimes(lines.length)
			expect(spy).toHaveBeenNthCalledWith(1, lines[0])
			expect(spy).toHaveBeenNthCalledWith(2, lines[1])
		} finally {
			spy.mockRestore()
		}
	})

	it('prints nothing when there are no lines', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_next_issues(undefined)
			expect(spy).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})
})

describe('print_next_issues - completed issue number', () => {
	it('passes the completed issue number as a number', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		await git_followup_workflow.print_next_issues('42')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
	})

	// `--issue-number "#42"` is the shape the positional parser accepts, so the exclusion must
	// read it the same way rather than silently skipping it.
	it('accepts the #N shape', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		await git_followup_workflow.print_next_issues('#42')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
	})

	it('passes undefined when no issue number is known', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		await git_followup_workflow.print_next_issues(undefined)

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(undefined)
	})

	// Number('42a') is NaN, which compares unequal to every issue number and would silently
	// disable the just-completed-issue exclusion.
	it('passes undefined for a non-numeric issue number instead of NaN', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		await git_followup_workflow.print_next_issues('42a')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(undefined)
	})
})

// The epic auto-close is gated on the merge for the same reason: on `--no-merge` the linked issue
// is still open and still the current task, so a "next" list would hide the one issue that matters.
describe('print_completion - merge gating', () => {
	it('lists next issues on a merged run', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_completion('42', true)
			expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
		} finally {
			spy.mockRestore()
		}
	})

	it('skips the next-issues list on a --no-merge run', async () => {
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_completion('42', false)
			expect(fetch_next_issue_lines_mock).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})

	// The pending-release line is the documented final line of the console output.
	it('prints the unreleased merge count last', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([NEXT_ISSUES_HEADER])
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_completion('42', true)
			const last_call = spy.mock.calls.at(-1)

			expect(last_call?.[0]).toBe(PENDING_SENTINEL)
		} finally {
			spy.mockRestore()
		}
	})
})

const { review_stamps } = await import('../scripts/review/review-stamps')
const clear_round_one_mock = vi.mocked(review_stamps.clear_round_one)

// The round-1 review snapshot's lifetime is one run, and `--no-merge` is not the end of one: the pull
// request is still open, and a record removed there lets the next round-1 brief write a fresh one
// against the already-fixed tree — the arm-A skip joshuafolkken/kit#1441 closed, arriving from the
// other side. Importing this module already ran `main()` once, so the counter is cleared first for the
// reason the next-issues suite states.
describe('the round-1 snapshot is cleared only by a merged run', () => {
	beforeEach(() => {
		clear_round_one_mock.mockClear()
	})

	it('clears the record when the run merged', () => {
		git_followup_workflow.clear_round_one_snapshot(true)

		expect(clear_round_one_mock).toHaveBeenCalledTimes(1)
	})

	it('leaves the record in place on a --no-merge run', () => {
		git_followup_workflow.clear_round_one_snapshot(false)

		expect(clear_round_one_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#1522. `/code-review` is forked by the harness into the *session's* working
// directory, so a run implementing in a lane can be reviewed against a different tree — one holding
// the previous child's already-merged code, where there is nothing wrong to find. The review returns
// no findings and the run reads that as clean. This is the seam where that stops being free.
describe('a merge is refused unless the review attested its checkout', () => {
	// The whole point: the defect produced *no* signal, so silence must not read as success.
	it.each([['missing'], ['mismatch']])('throws when the verdict is %s', async (status) => {
		attest_check_mock.mockResolvedValueOnce({ status })

		await expect(git_followup_workflow.assert_review_attested(true)).rejects.toThrow(
			REFUSAL_SENTINEL,
		)
	})

	it.each([['ok'], [NOT_REQUIRED]])('allows the merge when the verdict is %s', async (status) => {
		attest_check_mock.mockResolvedValueOnce({ status })

		await expect(git_followup_workflow.assert_review_attested(true)).resolves.toBeUndefined()
	})

	// A `--no-merge` run has not reached the gate this record guards, and nothing merges there.
	it('leaves a --no-merge run alone, and clears only on a merged one', async () => {
		attest_check_mock.mockClear()
		attest_clear_mock.mockClear()
		await git_followup_workflow.assert_review_attested(false)
		await git_followup_workflow.clear_review_target(false)

		expect(attest_check_mock).not.toHaveBeenCalled()
		expect(attest_clear_mock).not.toHaveBeenCalled()

		await git_followup_workflow.clear_review_target(true)

		expect(attest_clear_mock).toHaveBeenCalledTimes(1)
	})
})

// joshuafolkken/kit#1471. The report is emitted by the run that finished rather than by a person
// typing `diag`, and "finished" is the merge — the same gate the round-1 clear above uses, for the
// same reason: a `--no-merge` run's CI wait is not over, so its record would not be comparable.
describe('the run report is emitted only by a merged run', () => {
	beforeEach(() => {
		record_run_mock.mockClear()
	})

	it('records the run that merged, against the checkout it ran in', async () => {
		await git_followup_workflow.record_run_report('#42', true)

		expect(record_run_mock).toHaveBeenCalledWith(42, process.cwd())
	})

	it('records nothing on a --no-merge run', async () => {
		await git_followup_workflow.record_run_report('#42', false)

		expect(record_run_mock).not.toHaveBeenCalled()
	})

	it('records nothing when no issue number was given', async () => {
		await git_followup_workflow.record_run_report(undefined, true)

		expect(record_run_mock).not.toHaveBeenCalled()
	})

	it('prints every line the recorder returned', async () => {
		const heading = '📈 Run report — issue #42'

		record_run_mock.mockResolvedValueOnce([heading])
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await git_followup_workflow.record_run_report('#42', true)

		expect(info).toHaveBeenCalledWith(heading)
		info.mockRestore()
	})
})

// joshuafolkken/kit#1091. The hold a typed entry point claims before it starts is released on the one
// seam every finished run passes through, so nothing has to remember to type the release command. The
// merge gate is the same one the two records above use, and for the same reason: a `--no-merge` run's
// tree is still the one nobody else may start in.
describe('the working-tree hold is released only by a merged run', () => {
	beforeEach(() => {
		release_hold_mock.mockClear()
		worktree_directory_mock.mockResolvedValue(WORKTREE_DIRECTORY)
	})

	it('releases the hold on the work tree the run used', async () => {
		await git_followup_workflow.release_worktree_hold(true)

		expect(release_hold_mock).toHaveBeenCalledWith(`${WORKTREE_DIRECTORY}/hold.json`)
	})

	it('keeps the hold on a --no-merge run', async () => {
		await git_followup_workflow.release_worktree_hold(false)

		expect(release_hold_mock).not.toHaveBeenCalled()
	})

	it('reports success when the work tree could not be read', async () => {
		worktree_directory_mock.mockRejectedValueOnce(new Error('not a git repository'))

		await expect(git_followup_workflow.release_worktree_hold(true)).resolves.toBeUndefined()
		expect(release_hold_mock).not.toHaveBeenCalled()
	})
})

describe('resolve_branch_name', () => {
	it('returns the provided branch name trimmed', async () => {
		const result = await git_followup_workflow.resolve_branch_name('my-branch')

		expect(result).toBe('my-branch')
	})

	it('trims whitespace from provided branch name', async () => {
		const result = await git_followup_workflow.resolve_branch_name('  my-branch  ')

		expect(result).toBe('my-branch')
	})

	it('falls back to git_branch.current() when branch is undefined', async () => {
		const { git_branch } = await import('../scripts/git/git-branch')

		vi.mocked(git_branch.current).mockResolvedValue(RESOLVED_BRANCH)

		const result = await git_followup_workflow.resolve_branch_name(undefined)

		expect(result).toBe(RESOLVED_BRANCH)
	})

	it('falls back to git_branch.current() when branch is empty string', async () => {
		const { git_branch } = await import('../scripts/git/git-branch')

		vi.mocked(git_branch.current).mockResolvedValue(RESOLVED_BRANCH)

		const result = await git_followup_workflow.resolve_branch_name('')

		expect(result).toBe(RESOLVED_BRANCH)
	})
})
