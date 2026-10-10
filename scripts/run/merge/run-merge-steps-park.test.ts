import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { run_carry } from '#scripts/run/carry/run-carry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2769: the driver's park is explained on the issue, and a child GitHub merged but
// left OPEN is closed by `run:merge` through the same close `followup` uses.

const add_label_mock = vi.hoisted(() => vi.fn())
const comment_mock = vi.hoisted(() => vi.fn())
const remove_label_mock = vi.hoisted(() => vi.fn())
const ensure_closed_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_label: add_label_mock,
		issue_remove_label: remove_label_mock,
		issue_try_comment: comment_mock,
	},
}))

vi.mock('#scripts/followup/git-followup-issue-close', () => ({
	git_followup_issue_close: { ensure_issue_closed: ensure_closed_mock, CLOSE_RECOVERY: 'recover' },
}))

vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { reap_child: vi.fn() } }))

const { run_merge_steps } = await import('./run-merge-steps')

const CHILD = '2761'
const PR_URL = 'https://github.com/joshuafolkken/kit/pull/2768'
const CONTEXT = {
	child: CHILD,
	epic: undefined,
	repo: undefined,
	over: CONTEXT_CUT_THRESHOLD,
	owner: run_carry.NO_OWNER,
}
const IN_PROGRESS = 'in-progress'
// GitHub keeps the casing a label was created with (joshuafolkken/kit#3591).
const CREATED_CASING = 'In-Progress'

// The removal reads the issue's labels first and names the spelling it finds, so each test serves
// the ones the child carries.
function serve_labels(...names: ReadonlyArray<string>): void {
	vi.spyOn(git_gh_command, 'issue_get_labels_and_body').mockResolvedValue(
		JSON.stringify({ labels: names.map((name) => ({ name })) }),
	)
}

beforeEach(() => {
	add_label_mock.mockReset().mockResolvedValue(true)
	comment_mock.mockReset().mockResolvedValue(undefined)
	remove_label_mock.mockReset().mockResolvedValue(undefined)
	ensure_closed_mock.mockReset().mockResolvedValue(undefined)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
	serve_labels(IN_PROGRESS)
})

// joshuafolkken/kit#3591: the removal named the canonical spelling in the request path and swallowed
// its failure, so a label stored as `In-Progress` answered 404 and stayed on with no trace.
describe('run_merge_steps.do_failed — the stale in-progress goes through the shared removal', () => {
	it('drops a marker stored under another casing, by the spelling GitHub stored', async () => {
		serve_labels(CREATED_CASING)

		await run_merge_steps.do_failed(CONTEXT)

		expect(remove_label_mock).toHaveBeenCalledWith(CHILD, CREATED_CASING)
	})

	it('warns about a removal that failed, and still parks the child', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		remove_label_mock.mockRejectedValue(new Error('gh: Forbidden (HTTP 403)'))

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.is_parked).toBe(true)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('labels/in-progress'))
	})
})

describe('run_merge_steps.do_failed — the park is explained on the issue', () => {
	it('comments the reason when it parks the child with needs-decision', async () => {
		await run_merge_steps.do_failed(CONTEXT, run_merge_steps.CUT_RELAUNCH_CAUSE)

		expect(comment_mock).toHaveBeenCalledOnce()
		expect(comment_mock).toHaveBeenCalledWith(
			CHILD,
			expect.stringContaining(`- Why: ${run_merge_steps.CUT_RELAUNCH_CAUSE}`),
		)
		expect(comment_mock).toHaveBeenCalledWith(CHILD, expect.stringContaining(`fullrun #${CHILD}`))
	})

	it('comments nothing when the needs-decision label could not be written', async () => {
		add_label_mock.mockResolvedValue(false)

		await run_merge_steps.do_failed(CONTEXT)

		expect(comment_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3502: a child whose order is already recorded as an open `blocked-by` waits for its
// blocker — nothing for a person to decide, so no `needs-decision` and no failure counted.
const KIT = 'joshuafolkken/kit'
const BLOCKER = 3501
const NEEDS_DECISION = 'needs-decision'
const OWN_CARRY = {
	invocation: 'backlogrun #3435',
	started_at: new Date().toISOString(),
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

function spy_blockers(state: 'OPEN' | 'CLOSED'): void {
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([
		{ repo: KIT, number: BLOCKER, state },
	])
}

function spy_carry(carry: typeof OWN_CARRY & { is_handed_off?: boolean }): void {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
	vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry })
}

describe('run_merge_steps.do_failed — a child waiting on an open blocker', () => {
	it('releases the child to wait without needs-decision, a counted failure or a park', async () => {
		spy_blockers('OPEN')
		spy_carry(OWN_CARRY)
		const apply_spy = vi.spyOn(run_carry, 'apply_change').mockReturnValue(OWN_CARRY)

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result).toStrictEqual({
			carry: undefined,
			is_parked: false,
			is_refused: false,
			blockers: [`${KIT}#${String(BLOCKER)}`],
		})
		expect(add_label_mock).not.toHaveBeenCalled()
		expect(apply_spy).not.toHaveBeenCalled()
		expect(comment_mock).toHaveBeenCalledWith(
			CHILD,
			expect.stringContaining(`open blockers: ${KIT}#${String(BLOCKER)}`),
		)
		expect(remove_label_mock).toHaveBeenCalledWith(CHILD, IN_PROGRESS)
	})

	it('refuses a session that does not own the run before releasing the child', async () => {
		spy_blockers('OPEN')
		spy_carry({ ...OWN_CARRY, is_handed_off: true })

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.is_refused).toBe(true)
		expect(remove_label_mock).not.toHaveBeenCalled()
		expect(comment_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_steps.do_failed — a child with no open blocker is parked as before', () => {
	it('parks the child when its only blocker is closed', async () => {
		spy_blockers('CLOSED')

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.blockers).toStrictEqual([])
		expect(add_label_mock).toHaveBeenCalledWith(CHILD, NEEDS_DECISION)
	})

	it('parks the child when its blockers cannot be read', async () => {
		vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockRejectedValue(new Error('gh'))

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.is_parked).toBe(true)
		expect(add_label_mock).toHaveBeenCalledWith(CHILD, NEEDS_DECISION)
	})
})

describe('run_merge_steps.do_merged — a child merged while its issue stayed OPEN', () => {
	beforeEach(() => {
		vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
		vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
			existing: undefined,
			targets: { directory: '/nonexistent-lane-2769', branch: `${CHILD}-lane` },
		})
	})

	it('closes the issue, naming the merged pull request and run:merge', async () => {
		await run_merge_steps.do_merged({ ...CONTEXT, merged_pr: PR_URL })

		expect(ensure_closed_mock).toHaveBeenCalledWith(
			{ issue_number: CHILD, pr_url: PR_URL, closer: 'pnpm josh run:merge' },
			expect.anything(),
		)
	})

	it('closes nothing for a child GitHub already closed', async () => {
		await run_merge_steps.do_merged(CONTEXT)

		expect(ensure_closed_mock).not.toHaveBeenCalled()
	})
})
