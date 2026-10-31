import { beforeEach, describe, expect, it, vi } from 'vitest'

const unmoved_mock = vi.hoisted(() => vi.fn(() => true))

vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { is_unmoved: unmoved_mock } }))

const { run_ship_pair_runs } = await import('./run-ship-pair-runs')

// joshuafolkken/kit#5538: which run of a ship's scoped pair started checks, and why one ran again.

const TREE = { files: {}, base: 'base' }
const OK = 0
const FAILED = 1

beforeEach(() => {
	unmoved_mock.mockReset().mockReturnValue(true)
	run_ship_pair_runs.forget()
})

describe('run_ship_pair_runs.begin', () => {
	it('counts the first run without a reason or a log line', () => {
		expect(run_ship_pair_runs.begin(TREE)).toBeUndefined()
		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 1 })
	})

	it('names no reason on the first run after a pair that ran nothing', () => {
		run_ship_pair_runs.met(TREE, OK)
		unmoved_mock.mockReturnValue(false)

		expect(run_ship_pair_runs.begin(TREE)).toBeUndefined()
		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 1 })
	})

	it('names a run after a pair on a tree that moved since', () => {
		run_ship_pair_runs.begin(TREE)
		run_ship_pair_runs.met(TREE, OK)
		unmoved_mock.mockReturnValue(false)

		expect(run_ship_pair_runs.begin(TREE)).toBe('scoped pair run 2 (moved)')
		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 2, rerun: 'moved' })
	})

	it('names a run after a red pair on the same tree a recheck', () => {
		run_ship_pair_runs.begin(TREE)
		run_ship_pair_runs.met(TREE, FAILED)

		run_ship_pair_runs.begin(TREE)

		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 2, rerun: 'recheck' })
	})

	it('names a run after a green pair on the same tree that left no record', () => {
		run_ship_pair_runs.begin(TREE)
		run_ship_pair_runs.met(TREE, OK)

		run_ship_pair_runs.begin(TREE)

		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 2, rerun: 'no-record' })
	})
})

describe('run_ship_pair_runs.one_at_a_time', () => {
	it('starts a later turn only once the earlier one ended, even when it threw', async () => {
		const order: Array<string> = []
		const first = run_ship_pair_runs.one_at_a_time(async () => {
			await Promise.resolve()
			order.push('first')
			throw new Error('red')
		})
		const second = run_ship_pair_runs.one_at_a_time(async () => {
			order.push('second')

			return run_ship_pair_runs.current()
		})

		await expect(first).rejects.toThrow('red')
		expect(await second).toStrictEqual({})
		expect(order).toStrictEqual(['first', 'second'])
	})
})
