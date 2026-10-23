import { describe, expect, it, vi } from 'vitest'

const RESOLVED_BRANCH = vi.hoisted(() => 'resolved-branch')
// Deliberately not the real line's shape. What these two cases can prove is the wiring — that
// whatever `pending_release_line` returns is what gets printed, and printed last. The line's own
// wording is pinned where it is built, in `scripts/followup/git-followup-pending.test.ts`; asserting a
// realistic-looking string here would only prove the stub round-trips through `console.info`.
const PENDING_SENTINEL = vi.hoisted(() => 'pending-release-line-sentinel')

vi.mock('node:util', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	parseArgs: vi.fn().mockReturnValue({ values: {}, positionals: [] }),
}))

vi.mock('./git-pr-followup', () => ({
	git_pr_followup: { run: vi.fn<() => Promise<void>>().mockResolvedValue() },
}))

vi.mock('#scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('main') },
}))

vi.mock('#scripts/notify/git-notify', () => ({
	git_notify: { build_notify_config: vi.fn<() => void>().mockReturnValue() },
}))

vi.mock('#scripts/issue/git-next-issues', () => ({
	git_next_issues: {
		fetch_next_issue_lines: vi.fn<() => Promise<Array<string>>>().mockResolvedValue([]),
	},
}))

vi.mock('#scripts/git/git-error', () => ({
	git_error: { handle: vi.fn() },
}))

// **Mocked because the real one fetches the default branch** (joshuafolkken/kit#1486): the count has
// to come from main rather than from whatever branch is checked out, so resolving it touches the
// network. `main` runs at import time in this module, which would make every run of this suite do it.
vi.mock('./git-followup-pending', () => ({
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
vi.mock('#scripts/review/review-stamps', () => ({
	review_stamps: { clear_round_one: vi.fn() },
}))

// **Mocked for the same reason `review_stamps` above is** (joshuafolkken/kit#1522): `main` runs at
// import time, so the real clear would remove the checkout-attestation record of whatever run is
// executing this suite.
vi.mock('#scripts/review/review-attest', () => ({
	review_attest: { clear_here: vi.fn(async () => undefined) },
}))

// **Mocked for the same reason, and for one more**: the real review gates read that run's attestation
// and ledger, and would *refuse*, because a suite is not a review — importing this module would then
// throw before a single case ran. Their own cases are in `followup-review-gates.test.ts`.
const attested_mock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock(import('./followup-review-gates'), async (import_original) => {
	const { followup_review_gates } = await import_original()

	return {
		followup_review_gates: {
			...followup_review_gates,
			assert_review_attested: attested_mock,
			assert_review_recorded: vi.fn(async () => undefined),
		},
	}
})

const FEATURE_BRANCH = 'feature-branch'
const ALLOWS_MERGE_TITLE = 'allows the merge when the verdict is %s'
const NO_MERGE_TITLE = 'leaves a --no-merge run alone'

// **Mocked for the same reason** (joshuafolkken/kit#2446): the real check reads the branch diff and
// the pull request body over the network. Its default is `exempt`, so the import-time `main` passes.
const EVIDENCE_REFUSAL_SENTINEL = vi.hoisted(() => 'evidence-refusal-sentinel')
const evidence_check_mock = vi.hoisted(() => vi.fn(async () => 'exempt'))

vi.mock('#scripts/review/live-evidence', () => ({
	live_evidence: {
		check: evidence_check_mock,
		refusal_message: () => EVIDENCE_REFUSAL_SENTINEL,
	},
}))

// **Mocked for the same reason** (joshuafolkken/kit#3954): the real check re-reads the issue and the
// pull request body. Its default is no refusal, so the import-time `main` passes.
const MAP_REFUSAL = vi.hoisted(() => 'acceptance-map-refusal-sentinel')
const map_refusal_mock = vi.hoisted(() => vi.fn(async (): Promise<string | undefined> => undefined))

vi.mock('#scripts/review/acceptance-map-check', () => ({
	acceptance_map_check: { refusal: map_refusal_mock },
}))

// **Mocked for the same reason** (joshuafolkken/kit#4287): the real check reads the branch diff and
// the pull request body. Its default is no refusal, so the import-time `main` passes.
const REMOVED_REFUSAL = vi.hoisted(() => 'removed-tests-refusal-sentinel')
const removed_mock = vi.hoisted(() => vi.fn(async (): Promise<string | undefined> => undefined))

vi.mock('#scripts/review/removed-tests-check', () => ({
	removed_tests_check: { refusal: removed_mock },
}))

// **Mocked because `git_pr_followup` reaches `telegram-notify` and `main` runs at import time** — so
// an unmocked sender would put this suite one send away from a live HTTP request.
vi.mock('#scripts/notify/telegram-notify', () => ({
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

vi.mock('#scripts/run/hold/run-hold', () => ({
	run_hold: {
		hold_path: (directory: string) => `${directory}/hold.json`,
		release_hold: release_hold_mock,
		worktree_directory: worktree_directory_mock,
	},
}))

// **Mocked for the same reason** (joshuafolkken/kit#2919): `main` runs at import time, so the real step
// would commit and push the observation ledger of whatever checkout is executing this suite.
vi.mock('./git-followup-flush', () => ({
	git_followup_flush: { commit_ledger_step: vi.fn() },
}))

// **Mocked for the same reason** (joshuafolkken/kit#3023): `main` runs at import time, and the real
// read asks GitHub whether the branch's pull request merged. Answers "open" with the merge requested.
vi.mock('./git-followup-merged', () => ({
	git_followup_merged: {
		read_merge_plan: vi.fn(async (_branch: string, is_requested: boolean) => ({
			is_merged: false,
			should_merge: is_requested,
			merged_at: undefined,
		})),
	},
}))

const { git_followup_workflow } = await import('./git-followup-workflow')
const { git_followup_flush } = await import('./git-followup-flush')

// joshuafolkken/kit#3023. A pull request a person merged by hand is finished by re-running `followup`;
// the gates guard a merge this run no longer makes, and a ledger commit would land on a merged branch.
describe('prepare_merge — a pull request that has already merged', () => {
	const ISSUE = '3023'
	const BRANCH = 'merged-branch'

	it('asks no merge gate and commits no ledger line', async () => {
		attested_mock.mockClear()
		evidence_check_mock.mockClear()
		vi.mocked(git_followup_flush.commit_ledger_step).mockClear()
		await git_followup_workflow.prepare_merge(
			{ is_merged: true, should_merge: true, merged_at: '2026-10-04T00:00:00Z' },
			ISSUE,
			BRANCH,
		)

		expect(attested_mock).not.toHaveBeenCalled()
		expect(evidence_check_mock).not.toHaveBeenCalled()
		expect(git_followup_flush.commit_ledger_step).not.toHaveBeenCalled()
	})

	it('still runs both on an open pull request', async () => {
		vi.mocked(git_followup_flush.commit_ledger_step).mockClear()
		await git_followup_workflow.prepare_merge(
			{ is_merged: false, should_merge: true, merged_at: undefined },
			ISSUE,
			BRANCH,
		)

		expect(git_followup_flush.commit_ledger_step).toHaveBeenCalledWith(true, ISSUE)
	})
})

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

// joshuafolkken/kit#2446. A runtime change merges only with live-execution evidence in its body.
describe('a merge is refused unless a runtime change carries live-execution evidence', () => {
	const BRANCH = FEATURE_BRANCH

	it('throws when the verdict is required', async () => {
		evidence_check_mock.mockResolvedValueOnce('required')

		await expect(git_followup_workflow.assert_live_evidence(true, BRANCH)).rejects.toThrow(
			EVIDENCE_REFUSAL_SENTINEL,
		)
	})

	it.each([['satisfied'], ['exempt']])(ALLOWS_MERGE_TITLE, async (verdict) => {
		evidence_check_mock.mockResolvedValueOnce(verdict)

		await expect(git_followup_workflow.assert_live_evidence(true, BRANCH)).resolves.toBeUndefined()
	})

	it('asks about the branch being merged', async () => {
		evidence_check_mock.mockClear()
		await git_followup_workflow.assert_live_evidence(true, BRANCH)

		expect(evidence_check_mock).toHaveBeenCalledWith(BRANCH)
	})

	it(NO_MERGE_TITLE, async () => {
		evidence_check_mock.mockClear()
		await git_followup_workflow.assert_live_evidence(false, BRANCH)

		expect(evidence_check_mock).not.toHaveBeenCalled()
	})
})

describe('a merge is refused until every acceptance criterion maps to a row', () => {
	const BRANCH = FEATURE_BRANCH
	const ISSUE = '3954'

	it('throws the refusal the check names', async () => {
		map_refusal_mock.mockResolvedValueOnce(MAP_REFUSAL)

		await expect(
			git_followup_workflow.assert_acceptance_mapped(true, ISSUE, BRANCH),
		).rejects.toThrow(MAP_REFUSAL)
	})

	it('allows the merge when the check refuses nothing, asking about this issue and branch', async () => {
		map_refusal_mock.mockClear()

		await expect(
			git_followup_workflow.assert_acceptance_mapped(true, ISSUE, BRANCH),
		).resolves.toBeUndefined()
		expect(map_refusal_mock).toHaveBeenCalledWith(ISSUE, BRANCH)
	})

	it.each([
		[false, ISSUE],
		[true, undefined],
	])('asks nothing when merging is %s and the issue is %s', async (should_merge, issue) => {
		map_refusal_mock.mockClear()
		await git_followup_workflow.assert_acceptance_mapped(should_merge, issue, BRANCH)

		expect(map_refusal_mock).not.toHaveBeenCalled()
	})
})

describe('a merge is refused until every removed test is disposed of', () => {
	it('throws the refusal the check names for this branch, and asks nothing without a merge', async () => {
		removed_mock.mockClear().mockResolvedValueOnce(REMOVED_REFUSAL)

		await expect(
			git_followup_workflow.assert_removed_tests_disposed(true, FEATURE_BRANCH),
		).rejects.toThrow(REMOVED_REFUSAL)
		await git_followup_workflow.assert_removed_tests_disposed(false, FEATURE_BRANCH)

		expect(removed_mock).toHaveBeenCalledExactlyOnceWith(FEATURE_BRANCH)
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
		const { git_branch } = await import('#scripts/git/git-branch')

		vi.mocked(git_branch.current).mockResolvedValue(RESOLVED_BRANCH)

		const result = await git_followup_workflow.resolve_branch_name(undefined)

		expect(result).toBe(RESOLVED_BRANCH)
	})

	it('falls back to git_branch.current() when branch is empty string', async () => {
		const { git_branch } = await import('#scripts/git/git-branch')

		vi.mocked(git_branch.current).mockResolvedValue(RESOLVED_BRANCH)

		const result = await git_followup_workflow.resolve_branch_name('')

		expect(result).toBe(RESOLVED_BRANCH)
	})
})
