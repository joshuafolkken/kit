import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2024: the composite `run:merge` command, exercised end to end with the side-effect
// steps and the GitHub read mocked. The four branches the acceptance criteria name are each asserted —
// a merged child (under budget and over budget), a needs-decision child left parked, a failed child,
// and the failure guard tripping — plus the human-review stop and the unreadable-state retry.

const read_issue_mock = vi.hoisted(() => vi.fn())
const do_merged_mock = vi.hoisted(() => vi.fn())
const do_failed_mock = vi.hoisted(() => vi.fn())
const do_outage_mock = vi.hoisted(() => vi.fn())
const ask_next_mock = vi.hoisted(() => vi.fn())
const is_over_budget_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const read_exit_mock = vi.hoisted(() => vi.fn())
const is_outage_mock = vi.hoisted(() => vi.fn())
const has_resumable_cut_mock = vi.hoisted(() => vi.fn())
const resume_cut_mock = vi.hoisted(() => vi.fn())
const refused_carry_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))

vi.mock('#scripts/agent/api-outage', () => ({
	api_outage: { is_outage: is_outage_mock },
}))

vi.mock('./run-ending', () => ({
	run_ending: { read_exit: read_exit_mock },
}))

vi.mock('./run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: ask_next_mock,
		do_failed: do_failed_mock,
		do_merged: do_merged_mock,
		do_outage: do_outage_mock,
		has_resumable_cut: has_resumable_cut_mock,
		is_over_budget: is_over_budget_mock,
		refused_carry: refused_carry_mock,
		resume_cut: resume_cut_mock,
	},
}))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '2024'
const REPO = 'joshuafolkken/kit'
const EPIC_ARGS = [CHILD, '--epic', '900', '--repo', REPO]
const NEXT = '2039'
const SUCCESS = 0
const FAILURE = 1
const BELOW_GUARD = 1
const AT_GUARD = 3
const CLOSED = 'CLOSED'
const OPEN = 'OPEN'
const IN_PROGRESS = 'in-progress'
const NEEDS_DECISION = 'needs-decision'
const NEEDS_HUMAN_REVIEW = 'needs-human-review'

function state_read(
	state: string,
	labels: ReadonlyArray<string>,
	is_human_review = false,
): unknown {
	return { kind: 'state', state: { state, labels, is_human_review } }
}

function reset_cut_mocks(): void {
	has_resumable_cut_mock.mockReset().mockResolvedValue(false)
	is_outage_mock.mockReset().mockReturnValue(false)
	resume_cut_mock.mockReset().mockResolvedValue(true)
	refused_carry_mock.mockReset().mockResolvedValue(undefined)
}

beforeEach(() => {
	reset_cut_mocks()
	read_issue_mock.mockReset()
	do_merged_mock.mockReset().mockResolvedValue(undefined)
	do_failed_mock.mockReset()
	do_outage_mock.mockReset()
	ask_next_mock.mockReset().mockResolvedValue(NEXT)
	is_over_budget_mock.mockReset().mockResolvedValue(false)
	emit_mock.mockReset().mockResolvedValue(undefined)
	read_exit_mock.mockReset().mockReturnValue(undefined)

	vi.spyOn(console, 'info').mockImplementation(info_mock.mockReset())
})

describe('run_merge_cli.run — a merged child', () => {
	it('merges a closed child and offers the next', async () => {
		read_issue_mock.mockResolvedValue(state_read(CLOSED, []))

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(do_merged_mock).toHaveBeenCalledOnce()
		expect(info_mock).toHaveBeenCalledWith(NEXT)
		expect(emit_mock).toHaveBeenCalledWith('merge', `#${CHILD} merged`)
	})

	it('hands off when the merge crosses the budget', async () => {
		read_issue_mock.mockResolvedValue(state_read(CLOSED, []))
		is_over_budget_mock.mockResolvedValue(true)

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.OVER_TOKEN)
	})
})

describe('run_merge_cli.run — a parked child', () => {
	it('leaves a needs-decision child parked without merging it', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [NEEDS_DECISION]))

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(do_merged_mock).not.toHaveBeenCalled()
		expect(ask_next_mock).toHaveBeenCalledOnce()
		expect(emit_mock).toHaveBeenCalledWith('park', `#${CHILD} parked`)
	})

	it('returns the outcome beside the token to an in-process caller', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [NEEDS_DECISION]))
		const ctx = run_merge_cli.parse(EPIC_ARGS)

		expect(ctx).toBeDefined()
		if (ctx === undefined) return
		expect(await run_merge_cli.merge_child(ctx)).toEqual({
			outcome: 'parked',
			token: NEXT,
			code: SUCCESS,
		})
		expect(info_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_cli.run — a failed child', () => {
	it('parks a failed or budget-exhausted worker once without retrying it', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({
			carry: { failures: BELOW_GUARD },
			is_parked: true,
			is_refused: false,
		})

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(do_failed_mock).toHaveBeenCalledOnce()
		expect(ask_next_mock).toHaveBeenCalledOnce()
		expect(info_mock).toHaveBeenCalledWith(NEXT)
		expect(emit_mock).toHaveBeenCalledWith('park', `#${CHILD} parked (needs-decision)`)
	})

	it('stops when the failure guard trips', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({
			carry: { failures: AT_GUARD },
			is_parked: true,
			is_refused: false,
		})

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.STOP_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2484: a child that ended its session with a cut its successor never adopted is
// resumed in its own lane — not parked and not counted — while a child that simply stopped is parked.
const PARKED_FAILURE = { carry: { failures: BELOW_GUARD }, is_parked: true, is_refused: false }
const OUTPUT_ARGS = [...EPIC_ARGS, '--output', 'child.jsonl']

describe('run_merge_cli.run — a child that ended on a cut', () => {
	beforeEach(() => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue(PARKED_FAILURE)
	})

	it('resumes a cut child without parking it or counting a failure', async () => {
		has_resumable_cut_mock.mockResolvedValue(true)

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(resume_cut_mock).toHaveBeenCalledWith(CHILD)
		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(ask_next_mock).not.toHaveBeenCalled()
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.RESUMED_TOKEN)
		expect(emit_mock).toHaveBeenCalledWith('child-launch', `#${CHILD} resumed from its cut`)
	})

	it('resumes a cut child even when its exit record is an outage', async () => {
		has_resumable_cut_mock.mockResolvedValue(true)
		is_outage_mock.mockReturnValue(true)

		expect(await run_merge_cli.run(OUTPUT_ARGS)).toBe(SUCCESS)
		expect(do_outage_mock).not.toHaveBeenCalled()
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.RESUMED_TOKEN)
	})

	it('parks the child as before when its successor could not be relaunched', async () => {
		has_resumable_cut_mock.mockResolvedValue(true)
		resume_cut_mock.mockResolvedValue(false)

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(do_failed_mock).toHaveBeenCalledOnce()
		expect(emit_mock).toHaveBeenCalledWith('park', `#${CHILD} parked (needs-decision)`)
	})

	it('still parks a child that stopped without a cut', async () => {
		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(resume_cut_mock).not.toHaveBeenCalled()
		expect(do_failed_mock).toHaveBeenCalledOnce()
		expect(info_mock).toHaveBeenCalledWith(NEXT)
	})
})

// joshuafolkken/kit#2240: a child that could not reach the API is re-dispatched, not parked, and a run
// of consecutive outages stops the run as an environment failure rather than the children's.
describe('run_merge_cli.run — an API-outage child', () => {
	beforeEach(() => {
		is_outage_mock.mockReturnValue(true)
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
	})

	it('re-dispatches an outage child instead of parking it', async () => {
		do_outage_mock.mockResolvedValue({ carry: { outages: BELOW_GUARD }, is_refused: false })

		expect(await run_merge_cli.run(OUTPUT_ARGS)).toBe(SUCCESS)
		expect(do_outage_mock).toHaveBeenCalledOnce()
		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(ask_next_mock).toHaveBeenCalledOnce()
		expect(emit_mock).toHaveBeenCalledWith('outage', `#${CHILD} outage (re-dispatchable)`)
	})

	it('stops with the environment token when the outage guard trips', async () => {
		do_outage_mock.mockResolvedValue({ carry: { outages: AT_GUARD }, is_refused: false })

		expect(await run_merge_cli.run(OUTPUT_ARGS)).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.ENVIRONMENT_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})

	it('emits busy when the outage carry count is refused', async () => {
		do_outage_mock.mockResolvedValue({ carry: { outages: 0, owner_pid: 99_999 }, is_refused: true })

		expect(await run_merge_cli.run(OUTPUT_ARGS)).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.BUSY_TOKEN)
	})
})

// Without `--output` the exit record is never read, so an OPEN, unparked child is a plain failure — the
// outage split is off by default (joshuafolkken/kit#2240).
describe('run_merge_cli.run — the outage split is off without --output', () => {
	it('classifies an OPEN unparked child as failed when no output was passed', async () => {
		is_outage_mock.mockReturnValue(true)
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({
			carry: { failures: BELOW_GUARD },
			is_parked: true,
			is_refused: false,
		})

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(do_failed_mock).toHaveBeenCalledOnce()
		expect(do_outage_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_cli.run — a carry ownership refusal', () => {
	it('emits busy and exits 1 when the merged carry count is refused', async () => {
		read_issue_mock.mockResolvedValue(state_read(CLOSED, []))
		do_merged_mock.mockResolvedValue({ failures: 0, owner_pid: 99_999 })

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.BUSY_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})

	it('emits busy and exits 1 when the failed carry count is refused', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({
			carry: { failures: BELOW_GUARD },
			is_parked: false,
			is_refused: true,
		})

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.BUSY_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2484: the cut fallback counts nothing, but relaunching is still the owner's act.
describe('run_merge_cli.run — a cut fallback from a session that does not own the carry', () => {
	it('refuses busy without relaunching or parking', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		has_resumable_cut_mock.mockResolvedValue(true)
		refused_carry_mock.mockResolvedValue({ failures: 0, owner_pid: 99_999 })

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(FAILURE)
		expect(resume_cut_mock).not.toHaveBeenCalled()
		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.BUSY_TOKEN)
	})
})

describe('run_merge_cli.run — a stop and a refusal', () => {
	it('stops with an error when the failed child could not be parked', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({
			carry: { failures: BELOW_GUARD },
			is_parked: false,
			is_refused: false,
		})

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.STOP_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})

	it('stops for a human-review child without offering more', async () => {
		read_issue_mock.mockResolvedValue(state_read(OPEN, [NEEDS_HUMAN_REVIEW], true))

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(SUCCESS)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.HUMAN_REVIEW_TOKEN)
		expect(ask_next_mock).not.toHaveBeenCalled()
	})

	it('asks to retry when the child state cannot be read', async () => {
		read_issue_mock.mockResolvedValue({ kind: 'unreadable' })

		expect(await run_merge_cli.run(EPIC_ARGS)).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(run_merge_cli.RETRY_TOKEN)
	})

	it('uses the shared threshold without a numeric argument', () => {
		expect(run_merge_cli.parse([CHILD])?.over).toBe(CONTEXT_CUT_THRESHOLD)
	})

	it('accepts but ignores an in-flight legacy threshold', () => {
		expect(run_merge_cli.parse([CHILD, '--over', '300000'])?.over).toBe(CONTEXT_CUT_THRESHOLD)
		expect(run_merge_cli.parse([CHILD, '--over', '1'])?.over).toBe(CONTEXT_CUT_THRESHOLD)
	})

	it('keeps legacy threshold parsing strict', () => {
		expect(run_merge_cli.parse([CHILD, '--over', 'invalid'])).toBeUndefined()
	})
})

describe('run_merge_cli.parse — sanitizes subprocess-bound arguments', () => {
	it('refuses an epic that is not an issue number', () => {
		const argv = [CHILD, '--epic', 'evil', '--repo', REPO]

		expect(run_merge_cli.parse(argv)).toBeUndefined()
	})

	it('refuses a repository that is not an owner/repo slug', () => {
		const argv = [CHILD, '--epic', '900', '--repo=--force']

		expect(run_merge_cli.parse(argv)).toBeUndefined()
	})

	it('refuses an option-shaped slug whose half starts with a hyphen', () => {
		const argv = [CHILD, '--epic', '900', '--repo=--evil/x']

		expect(run_merge_cli.parse(argv)).toBeUndefined()
	})

	it('accepts a well-formed epic and repository', () => {
		expect(run_merge_cli.parse(EPIC_ARGS)?.repo).toBe(REPO)
	})
})
