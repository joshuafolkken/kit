import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
	it('owes the ask when the turn holds a ready line and no dispatch', () => {
		expect(backlog_ready.owes_offer(`watcher said ${READY_LINE}`, [])).toBe(true)
	})

	it('owes the ask when a stall is newer than the last launch', () => {
		expect(backlog_ready.owes_offer('', [LAUNCH, STALL])).toBe(true)
	})

	it('owes nothing once any later step follows the stall', () => {
		const drain = event(run_event_stream.EVENT_KIND.DRAIN, LATE)

		expect(backlog_ready.owes_offer('', [STALL, drain])).toBe(false)
	})

	it('owes nothing once a launch follows the stall', () => {
		expect(backlog_ready.owes_offer('', [STALL, event(LAUNCH.kind, LATE)])).toBe(false)
	})

	it('owes nothing when the turn asked, whatever the answer', () => {
		expect(backlog_ready.owes_offer(`${READY_LINE}\n${OFFER_CALL}\nwatch`, [STALL])).toBe(false)
		expect(backlog_ready.owes_offer(`${READY_LINE}\n${OFFER_CALL}\nwait`, [STALL])).toBe(false)
	})

	it('owes nothing when the turn launched', () => {
		expect(backlog_ready.owes_offer(`${READY_LINE}\n${LAUNCH_CALL}`, [])).toBe(false)
	})

	it('does not count prose that only names the commands', () => {
		expect(backlog_ready.owes_offer(`${READY_LINE} ${backlog_ready.OFFER_HINT}`, [])).toBe(true)
	})

	it('owes nothing without a signal', () => {
		expect(backlog_ready.owes_offer('relayed a progress line', [LAUNCH])).toBe(false)
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
