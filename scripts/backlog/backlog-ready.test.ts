import { josh_command } from '#scripts/josh/josh-run'
import type { RunCarry } from '#scripts/run/run-carry'
import { run_headless } from '#scripts/run/run-headless'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_ready, type ReadyPorts } from './backlog-ready'

// joshuafolkken/kit#2452: a parent woken five times relayed each progress line without asking for the
// next issue while a runnable one sat idle beside free lanes.

const FREE = 4
const READY_LINE = 'ready #2445 #2446 · free lanes 4'
const EARLY = '2026-09-23T12:00:00.000Z'

function ports(overrides: Partial<ReadyPorts> = {}): ReadyPorts {
	return {
		free_lane_count: async () => FREE,
		ready_issues: async () => ['2445', '2446'],
		...overrides,
	}
}

async function parent(): Promise<boolean> {
	return true
}

async function not_parent(): Promise<boolean> {
	return false
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_ready.ready_line', () => {
	it('names the runnable issues and the free lanes', () => {
		const line = backlog_ready.ready_line({ issues: ['2445', '2446'], free_lanes: FREE })

		expect(line).toBe(READY_LINE)
	})

	it('prints nothing with no runnable issue or no free lane', () => {
		expect(backlog_ready.ready_line({ issues: [], free_lanes: FREE })).toBeUndefined()
		expect(backlog_ready.ready_line({ issues: ['2445'], free_lanes: 0 })).toBeUndefined()
	})
})

describe('backlog_ready.read_ready', () => {
	it('skips the backlog read when no lane is free', async () => {
		const ready_issues = vi.fn(async () => ['2445'])
		const reading = await backlog_ready.read_ready(
			ports({ free_lane_count: async () => 0, ready_issues }),
		)

		expect(reading).toEqual({ issues: [], free_lanes: 0 })
		expect(ready_issues).not.toHaveBeenCalled()
	})
})

describe('backlog_ready.print_ready_line', () => {
	it('prints the ready line to the driving parent on a wake', async () => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await backlog_ready.print_ready_line(ports(), parent)

		expect(info).toHaveBeenCalledWith(READY_LINE)
	})

	it('prints nothing outside a backlogrun parent', async () => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await backlog_ready.print_ready_line(ports(), not_parent)

		expect(info).not.toHaveBeenCalled()
	})

	it('swallows a failed reading', async () => {
		const failing = ports({
			ready_issues: async () => {
				throw new Error('gh')
			},
		})

		await expect(backlog_ready.print_ready_line(failing, parent)).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#2472: a `--only` run's work is its named list, so the pool is never its pick-up.
function record(invocation: string): RunCarry {
	return { invocation, started_at: EARLY, merged: 0, filed: 0, cuts: 0, failures: 0, outages: 0 }
}

describe('backlog_ready.drains_pool', () => {
	it('drains the pool without a record, or under a run that is not --only', () => {
		expect(backlog_ready.drains_pool(undefined)).toBe(true)
		expect(backlog_ready.drains_pool(record('backlogrun #2447 --max 5'))).toBe(true)
	})

	it('never drains the pool under a --only run, over issues or an epic', () => {
		expect(backlog_ready.drains_pool(record('backlogrun #2447 #2462 --only'))).toBe(false)
		expect(backlog_ready.drains_pool(record('backlogrun #2400 --only'))).toBe(false)
	})
})

describe('backlog_ready.print_offer_hint', () => {
	it('hints the ask to the driving parent alone', async () => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await backlog_ready.print_offer_hint(not_parent)
		expect(info).not.toHaveBeenCalled()

		await backlog_ready.print_offer_hint(parent)
		expect(info).toHaveBeenCalledWith(backlog_ready.OFFER_HINT)
	})
})

// joshuafolkken/kit#2503: the arrival probe reads the pool bounded, with stderr piped; the pick-up read
// is unchanged.
describe('backlog_ready.read_backlog_next', () => {
	const TIMEOUT_MS = 30_000
	const BACKLOG_NEXT = 'backlog:next'
	const ANSWER = { code: 0, out: '2445' }

	beforeEach(() => {
		vi.spyOn(run_headless, 'current_carry').mockResolvedValue(undefined)
	})

	it('bounds the read and pipes stderr when given a timeout', async () => {
		const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue(ANSWER)

		await expect(backlog_ready.read_backlog_next(TIMEOUT_MS)).resolves.toEqual(ANSWER)
		expect(run).toHaveBeenCalledWith([BACKLOG_NEXT], false, TIMEOUT_MS)
	})

	it('keeps the pick-up read unbounded, with stderr forwarded', async () => {
		const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue(ANSWER)

		await expect(backlog_ready.ready_issues()).resolves.toEqual(['2445'])
		expect(run).toHaveBeenCalledWith([BACKLOG_NEXT], true, undefined)
	})
})
