import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_wake_code } from '#scripts/run/wake/run-wake-code'
import { run_wake_takeover } from '#scripts/run/wake/run-wake-takeover'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_handover } from './run-ship-handover'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_relaunch } from './run-ship-relaunch'
import type { ShipArguments } from './run-ship-steps'

// joshuafolkken/kit#4849: a supervisor whose sync changed its own code hands the ship to a successor on
// that code; one whose code is unchanged, or whose successor did not take over, runs the rest itself.

const SUCCESSOR_PID = 2222
const REPOSITORY = '/repository/kit'
// The note leads with its issue, so `run:board` attributes it to the lane.
const HANDED_NOTE = /^#4849 .*handed the ship to process 2222/u
const ARGS: ShipArguments = {
	title: 'Hand a ship to a supervisor on the new code #4849',
	number: '4849',
	notify: [],
	body: [],
	body_path: undefined,
	cites: [],
	is_review: true,
	is_detach: false,
	unpinned_ok: [],
}

async function stale(): Promise<boolean> {
	return true
}

async function unchanged(): Promise<boolean> {
	return false
}

beforeEach(() => {
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(run_ship_probe, 'repository_directory').mockResolvedValue(REPOSITORY)
	vi.spyOn(run_ship_relaunch, 'relaunch').mockReturnValue(SUCCESSOR_PID)
	vi.spyOn(run_wake_takeover, 'await_takeover').mockResolvedValue('taken')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('run_ship_handover.hand_over', () => {
	it('starts no successor while the code is unchanged', async () => {
		await expect(run_ship_handover.hand_over(ARGS, unchanged)).resolves.toBeUndefined()
		expect(run_ship_relaunch.relaunch).not.toHaveBeenCalled()
	})

	it('hands the ship to the successor that took it over, and says so on the stream', async () => {
		const section = await run_ship_handover.hand_over(ARGS, stale)

		expect(section).toMatchObject({ code: 0 })
		expect(section?.body).toContain(String(SUCCESSOR_PID))
		expect(run_wake_takeover.await_takeover).toHaveBeenCalledWith(SUCCESSOR_PID, expect.anything())
		expect(run_event_stream_emit.emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.NOTE,
			expect.stringMatching(HANDED_NOTE),
		)
	})

	it('reads the take-over off the record, which the launched successor claims', async () => {
		vi.mocked(run_wake_takeover.await_takeover).mockRestore()
		vi.spyOn(run_ship_relaunch, 'holder_pid').mockReturnValue(SUCCESSOR_PID)

		await expect(run_ship_handover.hand_over(ARGS, stale)).resolves.toMatchObject({ code: 0 })
		expect(run_ship_relaunch.holder_pid).toHaveBeenCalledWith(REPOSITORY, ARGS.number)
	})

	it.each(['died', 'unclaimed'] as const)(
		'runs on itself where the successor %s',
		async (result) => {
			vi.mocked(run_wake_takeover.await_takeover).mockResolvedValue(result)

			await expect(run_ship_handover.hand_over(ARGS, stale)).resolves.toBeUndefined()
		},
	)

	it('runs on itself where no successor started', async () => {
		vi.mocked(run_ship_relaunch.relaunch).mockReturnValue(undefined)

		await expect(run_ship_handover.hand_over(ARGS, stale)).resolves.toBeUndefined()
		expect(run_wake_takeover.await_takeover).not.toHaveBeenCalled()
	})
})

describe('run_ship_handover.watch', () => {
	it('watches nothing in a ship outside a supervisor', async () => {
		vi.stubEnv(run_ship_detach.SUPERVISED_KEY, undefined)
		const watch = vi.spyOn(run_wake_code, 'watch')

		await expect((await run_ship_handover.watch())()).resolves.toBe(false)
		expect(watch).not.toHaveBeenCalled()
	})

	it("watches the ship entry's import closure in a supervisor", async () => {
		vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '1')
		const watch = vi.spyOn(run_wake_code, 'watch').mockResolvedValue(stale)
		const source = vi.spyOn(run_wake_code, 'source_of')

		await expect((await run_ship_handover.watch())()).resolves.toBe(true)
		expect(watch).toHaveBeenCalledOnce()
		expect(source.mock.calls[0]?.[1]).toMatch(/run-ship-cli\.ts$/u)
	})
})
