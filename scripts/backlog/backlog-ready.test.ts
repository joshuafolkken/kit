import { josh_command } from '#scripts/josh/josh-run'
import type { RunCarry } from '#scripts/run/run-carry'
import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'
import { run_headless } from '#scripts/run/run-headless'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_ready, type ReadyPorts } from './backlog-ready'

// joshuafolkken/kit#2452: a parent woken five times relayed each progress line without asking for the
// next issue while a runnable one sat idle beside free lanes.

const FREE = 4
const READY_LINE = 'ready #2445 #2446 · free lanes 4'
const OFFER_CALL = '{"type":"tool_use","input":{"command":"pnpm josh backlog:offer --started x"}}'
const LAUNCH_CALL = '{"type":"tool_use","input":{"command":"cd /x && pnpm josh lane:launch 2445"}}'
const EARLY = '2026-09-23T12:00:00.000Z'
const LATE = '2026-09-23T12:30:00.000Z'

function event(kind: string, at: string): RunEvent {
	return { pos: 0, at, kind, text: '' }
}

const STALL = event(run_event_stream.EVENT_KIND.STALL, LATE)
const LAUNCH = event(run_event_stream.EVENT_KIND.CHILD_LAUNCH, EARLY)

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
		expect(backlog_ready.has_ready_line(line ?? '')).toBe(true)
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

describe('backlog_ready.owes_offer', () => {
	it('owes the ask when the turn holds a ready line and no dispatch', async () => {
		expect(await backlog_ready.owes_offer(`watcher said ${READY_LINE}`, [], ports())).toBe(true)
	})

	it('owes the ask when a stall is newer than the last launch and work is still ready', async () => {
		expect(await backlog_ready.owes_offer('', [LAUNCH, STALL], ports())).toBe(true)
	})

	it('owes nothing once any later step follows the stall', async () => {
		const drain = event(run_event_stream.EVENT_KIND.DRAIN, LATE)

		expect(await backlog_ready.owes_offer('', [STALL, drain], ports())).toBe(false)
	})

	it('owes nothing once a launch follows the stall', async () => {
		expect(await backlog_ready.owes_offer('', [STALL, event(LAUNCH.kind, LATE)], ports())).toBe(
			false,
		)
	})

	it('owes nothing when the turn asked, whatever the answer', async () => {
		const watch = `${READY_LINE}\n${OFFER_CALL}\nwatch`
		const wait = `${READY_LINE}\n${OFFER_CALL}\nwait`

		expect(await backlog_ready.owes_offer(watch, [STALL], ports())).toBe(false)
		expect(await backlog_ready.owes_offer(wait, [STALL], ports())).toBe(false)
	})

	it('owes nothing when the turn launched', async () => {
		expect(await backlog_ready.owes_offer(`${READY_LINE}\n${LAUNCH_CALL}`, [], ports())).toBe(false)
	})

	it('does not count prose that only names the commands', async () => {
		const prose = `${READY_LINE} ${backlog_ready.OFFER_HINT}`

		expect(await backlog_ready.owes_offer(prose, [], ports())).toBe(true)
	})

	it('owes nothing without a signal', async () => {
		expect(await backlog_ready.owes_offer('relayed a progress line', [LAUNCH], ports())).toBe(false)
	})
})

// joshuafolkken/kit#2472: a stall recorded while ready work existed kept blocking after that work
// left the pool, because the pending stall alone was read as the signal.
describe('backlog_ready.owes_offer — a stale stall', () => {
	it('owes nothing once the stalled work is no longer ready', async () => {
		const empty = ports({ ready_issues: async () => [] })

		expect(await backlog_ready.owes_offer('', [STALL], empty)).toBe(false)
	})

	it('owes nothing once no lane is free for it', async () => {
		const full = ports({ free_lane_count: async () => 0 })

		expect(await backlog_ready.owes_offer('', [STALL], full)).toBe(false)
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

// joshuafolkken/kit#2472: the Stop hook's stall check and pick-up check read the backlog once between them.
describe('backlog_ready.shared_ports', () => {
	it('reads each port once however many checks ask', async () => {
		const free_lane_count = vi.fn(async () => FREE)
		const ready_issues = vi.fn(async () => ['2445'])
		const shared = backlog_ready.shared_ports(ports({ free_lane_count, ready_issues }))

		await backlog_ready.read_ready(shared)
		expect(await backlog_ready.owes_offer('', [STALL], shared)).toBe(true)

		expect(free_lane_count).toHaveBeenCalledTimes(1)
		expect(ready_issues).toHaveBeenCalledTimes(1)
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
