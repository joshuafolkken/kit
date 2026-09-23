import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'

const add_label_mock = vi.hoisted(() => vi.fn())
const remove_label_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_label: add_label_mock,
		issue_remove_label: remove_label_mock,
	},
}))

const reap_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lane/lane-reap', () => ({
	lane_reap: { reap_child: reap_mock },
}))

const { run_merge_steps } = await import('./run-merge-steps')

const CONTEXT = {
	child: '2070',
	epic: undefined,
	repo: undefined,
	over: CONTEXT_CUT_THRESHOLD,
	owner: run_carry.NO_OWNER,
}

// A carry record whose budget has been handed off to a successor (joshuafolkken/kit#2114).
const HANDED_OFF_CARRY = {
	invocation: 'backlogrun #1 #2',
	started_at: new Date().toISOString(),
	merged: 0,
	filed: 0,
	cuts: 1,
	failures: 0,
	outages: 0,
	is_handed_off: true as const,
}

beforeEach(() => {
	add_label_mock.mockReset()
	remove_label_mock.mockReset().mockResolvedValue(undefined)
	reap_mock.mockReset().mockReturnValue([])
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
})

// joshuafolkken/kit#2421: the branches that judge a child finished are where its lingering process is
// ended — a hung child left running answers the pgrep liveness check `alive` for its number forever.
describe('run_merge_steps — ending the child process where the child is judged finished', () => {
	it('do_failed terminates the abandoned child', async () => {
		await run_merge_steps.do_failed(CONTEXT)

		expect(reap_mock).toHaveBeenCalledWith(CONTEXT.child)
	})

	it('do_outage terminates the old child before the re-dispatch launches another', async () => {
		await run_merge_steps.do_outage(CONTEXT)

		expect(reap_mock).toHaveBeenCalledWith(CONTEXT.child)
	})

	it('touches no process when the carry record refused the count', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: HANDED_OFF_CARRY })

		await run_merge_steps.do_failed(CONTEXT)

		expect(reap_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_steps.do_failed — parking is part of the result', () => {
	it('reports a failed needs-decision label write instead of treating the child as parked', async () => {
		add_label_mock.mockResolvedValue(false)

		expect(await run_merge_steps.do_failed(CONTEXT)).toStrictEqual({
			carry: undefined,
			is_parked: false,
			is_refused: false,
		})
	})
})

// joshuafolkken/kit#2240: an API-outage child is left re-dispatchable — its `in-progress` is dropped so
// the next offer can hand it back, but it is never parked with `needs-decision`.
describe('run_merge_steps.do_outage — re-dispatchable, never parked', () => {
	it('drops in-progress but does not add needs-decision', async () => {
		await run_merge_steps.do_outage(CONTEXT)

		expect(remove_label_mock).toHaveBeenCalledTimes(1)
		expect(add_label_mock).not.toHaveBeenCalled()
	})

	it('returns is_refused and skips label writes when the record is handed off', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: HANDED_OFF_CARRY })

		const result = await run_merge_steps.do_outage(CONTEXT)

		expect(result.is_refused).toBe(true)
		expect(remove_label_mock).not.toHaveBeenCalled()
		expect(add_label_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_steps — carry owner check (joshuafolkken/kit#2114)', () => {
	beforeEach(() => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/stub')
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry: HANDED_OFF_CARRY })
	})

	it('do_merged: returns the carry and skips git ops when the record is handed off', async () => {
		const result = await run_merge_steps.do_merged(CONTEXT)

		expect(result).toStrictEqual(HANDED_OFF_CARRY)
	})

	it('do_failed: returns is_refused and skips label writes when the record is handed off', async () => {
		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result.is_refused).toBe(true)
		expect(add_label_mock).not.toHaveBeenCalled()
		expect(remove_label_mock).not.toHaveBeenCalled()
	})

	it('do_merged: refuses an expired record whose budget was handed off', async () => {
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'expired', carry: HANDED_OFF_CARRY })

		expect(await run_merge_steps.do_merged(CONTEXT)).toStrictEqual(HANDED_OFF_CARRY)
	})
})
