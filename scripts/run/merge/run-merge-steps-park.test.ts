import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_stalled } from '#scripts/run/park/run-stalled'
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

const close_epics_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic-close', () => ({
	epic_close: { close_completed_epics: close_epics_mock },
}))

const ship_cause_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-merge-ship', () => ({ run_merge_ship: { cause: ship_cause_mock } }))

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

function stub_issue_reads(): void {
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
	vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(undefined)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: [IN_PROGRESS], is_human_review: false },
	})
}

beforeEach(() => {
	add_label_mock.mockReset().mockResolvedValue(true)
	comment_mock.mockReset().mockResolvedValue(undefined)
	remove_label_mock.mockReset().mockResolvedValue(undefined)
	ensure_closed_mock.mockReset().mockResolvedValue(undefined)
	close_epics_mock.mockReset().mockResolvedValue(undefined)
	ship_cause_mock.mockReset().mockReturnValue(undefined)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
	stub_issue_reads()
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(undefined)
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
	it('comments the reason when it parks the child with run:stalled', async () => {
		await run_merge_steps.do_failed(CONTEXT, run_stalled.CUT_NOT_RELAUNCHED)

		expect(comment_mock).toHaveBeenCalledOnce()
		expect(comment_mock).toHaveBeenCalledWith(
			CHILD,
			expect.stringContaining(`- Why: ${run_stalled.CUT_NOT_RELAUNCHED.why}`),
		)
		expect(comment_mock).toHaveBeenCalledWith(CHILD, expect.stringContaining(`fullrun #${CHILD}`))
	})

	it('comments nothing when the run:stalled label could not be written', async () => {
		add_label_mock.mockResolvedValue(false)

		await run_merge_steps.do_failed(CONTEXT)

		expect(comment_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3808: the ship's stop is the reason a person needs, not the ended session.
describe('run_merge_steps.do_failed — a child whose detached ship ended', () => {
	const SHIP_CAUSE = {
		short: 'review failed',
		why: 'its detached ship stopped and was not fixed: #2761 review.',
	}

	it('parks it for the ship’s stop', async () => {
		ship_cause_mock.mockReturnValue(SHIP_CAUSE)

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(ship_cause_mock).toHaveBeenCalledWith(CHILD)
		expect(comment_mock).toHaveBeenCalledWith(
			CHILD,
			expect.stringContaining(`- Why: ${SHIP_CAUSE.why}`),
		)
		expect(result.cause).toBe(SHIP_CAUSE.short)
	})

	it('keeps the caller’s cause over the ship’s', async () => {
		ship_cause_mock.mockReturnValue(SHIP_CAUSE)

		const result = await run_merge_steps.do_failed(CONTEXT, run_stalled.CUT_NOT_RELAUNCHED)

		expect(ship_cause_mock).not.toHaveBeenCalled()
		expect(result.cause).toBe(run_stalled.CUT_NOT_RELAUNCHED.short)
	})

	it('falls back to the ended session when no ship ended', async () => {
		await run_merge_steps.do_failed(CONTEXT)

		expect(comment_mock).toHaveBeenCalledWith(
			CHILD,
			expect.stringContaining('- Why: the child’s session ended with its issue still open'),
		)
	})
})

// joshuafolkken/kit#3502: a child whose order is already recorded as an open `blocked-by` waits for its
// blocker — nothing for a person to decide, so no `needs-decision` and no failure counted.
const KIT = 'joshuafolkken/kit'
const BLOCKER = 3501
// joshuafolkken/kit#4102: a mechanical park carries `run:stalled`, never a person's `needs-decision`.
const RUN_STALLED = 'run:stalled'
const NOT_BEFORE = 'not-before'
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
			waits: [`${KIT}#${String(BLOCKER)}`],
		})
		expect(add_label_mock).not.toHaveBeenCalled()
		expect(apply_spy).not.toHaveBeenCalled()
		expect(comment_mock).toHaveBeenCalledWith(
			CHILD,
			expect.stringContaining(`waits on: ${KIT}#${String(BLOCKER)}`),
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

		expect(result.waits).toStrictEqual([])
		expect(add_label_mock).toHaveBeenCalledWith(CHILD, RUN_STALLED)
	})

	it('parks the child when its blockers cannot be read', async () => {
		vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockRejectedValue(new Error('gh'))

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.is_parked).toBe(true)
		expect(add_label_mock).toHaveBeenCalledWith(CHILD, RUN_STALLED)
	})
})

// joshuafolkken/kit#4076: a child whose body declares a start date still ahead was released by its
// session to wait for it — the date is recorded, so nothing for a person to decide and no failure.
const DAY_MS = 86_400_000

function start_date_body(offset_ms: number): string {
	const date = new Date(Date.now() + offset_ms).toISOString().slice(0, '2026-10-24T23:29'.length)

	return `## 背景\n\n- 種別: 不具合\n- 実施可能日: ${date}Z\n\n## 現象\n`
}

describe('run_merge_steps.do_failed — a child waiting on its declared start date', () => {
	it('releases the child to wait, naming the date, without needs-decision or a count', async () => {
		const body = start_date_body(DAY_MS)
		const date = /実施可能日: (?<date>\S+)/u.exec(body)?.groups?.['date']

		vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(body)
		spy_carry(OWN_CARRY)
		const apply_spy = vi.spyOn(run_carry, 'apply_change').mockReturnValue(OWN_CARRY)

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.waits).toStrictEqual([`not before ${String(date)}`])
		expect(add_label_mock).not.toHaveBeenCalled()
		expect(apply_spy).not.toHaveBeenCalled()
		expect(comment_mock).toHaveBeenCalledWith(
			CHILD,
			expect.stringContaining(`waits on: not before ${String(date)}`),
		)
	})

	it.each([
		['a date already past', start_date_body(-DAY_MS)],
		['no declaration', '## 背景\n\n- 種別: 不具合\n'],
		['an unreadable body', undefined],
	])('parks the child for %s', async (_label, body) => {
		vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(body)

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.waits).toStrictEqual([])
		expect(add_label_mock).toHaveBeenCalledWith(CHILD, RUN_STALLED)
	})
})

describe('run_merge_steps.do_failed — a child waiting on its declared samples', () => {
	it('releases the child to wait, naming the pull request it waits on', async () => {
		const body = '## 背景\n\n- 種別: 不具合\n- 実施可能条件: #4313 のマージ後 10 マージ\n'

		vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(body)
		vi.spyOn(issue_sample_gate, 'prime').mockResolvedValue()
		spy_carry(OWN_CARRY)

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.waits).toStrictEqual(['until the merge of #4313 is read'])
		expect(add_label_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4102: the `not-before` label stands in for the body only where the body is unreadable.
describe('run_merge_steps.do_failed — a child carrying the not-before label', () => {
	beforeEach(() => {
		vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
			kind: 'state',
			state: { state: 'OPEN', labels: [IN_PROGRESS, NOT_BEFORE], is_human_review: false },
		})
	})

	it('releases the child to wait on its not-before label when the body cannot be read', async () => {
		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.waits).toStrictEqual(['a start date still ahead (`not-before`)'])
		expect(add_label_mock).not.toHaveBeenCalled()
	})

	it('parks the child carrying a stale not-before label when its body declares no date', async () => {
		vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue('## 背景\n')

		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.waits).toStrictEqual([])
		expect(add_label_mock).toHaveBeenCalledWith(CHILD, RUN_STALLED)
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

	it('closes the epics a child closed outside followup completed', async () => {
		await run_merge_steps.do_merged(CONTEXT)

		expect(close_epics_mock).toHaveBeenCalledWith({ issue_number: CHILD, is_merged: true })
	})
})
