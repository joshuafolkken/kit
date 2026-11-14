import { lane_await } from '#scripts/lane/lane-await'
import { afterEach, expect, it, vi } from 'vitest'
import type { DriveContext } from './backlog-drive-args'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_record } from './backlog-drive-record'
import { backlog_drive_tick } from './backlog-drive-tick'

// joshuafolkken/kit#7016: a child's liveness is answered by the tick's shared snapshot, not a `pgrep`
// per child.

const CHILD = '7016'
const CONTEXT: DriveContext = {
	owner: String(process.pid),
	active: undefined,
	forwarded: [],
	exclude: [],
	awaited: [],
	window_ms: undefined,
	window: undefined,
	is_only: false,
	stopped: undefined,
}

afterEach(() => {
	vi.restoreAllMocks()
})

it('asks the given running check rather than the per-issue probe', () => {
	const probe = vi.spyOn(lane_await, 'is_process_running_default')
	const is_running = vi.fn(() => true)
	const ports = backlog_drive_cli.child_ports([CHILD], String(process.pid), is_running)

	expect(ports.is_finished(CHILD)).toBe(false)
	expect(is_running).toHaveBeenCalledWith(CHILD)
	expect(probe).not.toHaveBeenCalled()
})

it('wires one tick share into the loop tick start and the stream reads', () => {
	const share = { is_running: vi.fn(() => true), read: vi.fn(async () => []), begin_tick: vi.fn() }
	const tick_share = vi.spyOn(backlog_drive_tick, 'tick_share').mockReturnValue(share)
	const record_ports = vi.spyOn(backlog_drive_record, 'record_ports')
	const holds = { hold: vi.fn(), answering: <T>(offer: T): T => offer, end: vi.fn() }
	const ports = backlog_drive_cli.ports_of(CONTEXT, [], { state: undefined as never }, holds)

	expect(tick_share).toHaveBeenCalledTimes(1)
	expect(ports.begin_tick).toBe(share.begin_tick)
	expect(record_ports).toHaveBeenCalledWith(share.read)
})

// joshuafolkken/kit#7510: the hold recorder reads every offer answer, so the driver's end can name a drain.
it('hands the offer port to the hold recorder', () => {
	const offer = vi.fn()
	const holds = { hold: vi.fn(), answering: vi.fn(() => offer), end: vi.fn() }
	const ports = backlog_drive_cli.ports_of(CONTEXT, [], { state: undefined as never }, holds)

	expect(holds.answering).toHaveBeenCalledOnce()
	expect(ports.offer).toBe(offer)
})
