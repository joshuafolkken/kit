import { describe, expect, it, vi } from 'vitest'

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
	vi
		.fn<() => Promise<{ is_recorded: boolean; lines: Array<string> }>>()
		.mockResolvedValue({ is_recorded: true, lines: [] }),
)

vi.mock('../scripts/time/time-history', () => ({
	time_history: { record_run: record_run_mock },
}))

// **Mocked for the same reason the recorder above is** (joshuafolkken/kit#1628): a run whose record
// did not land now sends a `warning` Telegram from the tail, and `main` runs at import time — so an
// unmocked sender would put this suite one unrecorded run away from a live HTTP request.
vi.mock('../scripts/git/telegram-notify', () => ({
	telegram_notify: { send_or_report: vi.fn(async () => true) },
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

	// A `--no-merge` run has not reached the gate this record guards, and nothing merges there. The
	// clearing half moved with the run's tail — `git-followup-finish.test.ts` covers it.
	it('leaves a --no-merge run alone', async () => {
		attest_check_mock.mockClear()
		await git_followup_workflow.assert_review_attested(false)

		expect(attest_check_mock).not.toHaveBeenCalled()
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
