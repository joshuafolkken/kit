import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_cli } from './run-ship-cli'
import { run_ship_conflict_probe } from './run-ship-conflict-probe'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_handover } from './run-ship-handover'
import { run_ship_pre_detach_timed } from './run-ship-pre-detach-timed'
import { run_ship_preflight } from './run-ship-preflight'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_recorded_fixture } from './run-ship-recorded-fixture'
import { run_ship_reship } from './run-ship-reship'

// joshuafolkken/kit#6141: a detached re-ship after a review failure hands off without the preflight
// and the pre-detach checks; any other ship runs them first. Which stop makes it due is pinned in
// `run-ship-reship.test.ts`; here the answer is stubbed.

const OK = 0
const RED = 1
const BASE = 'a'.repeat(40)
const TITLE = 'Skip the pre-detach region on a re-ship after a review failure #6141'
const ARGV = [TITLE, '--detach', '--review']

function stub_stages(): void {
	vi.spyOn(run_ship_body_draft, 'with_draft').mockImplementation(async (args) => args)
	vi.spyOn(run_ship_probe, 'record_target').mockResolvedValue(undefined)
	vi.spyOn(run_ship_probe, 'read_state').mockResolvedValue({
		is_committed: false,
		is_pushed: false,
		is_merged: false,
	})
	vi.spyOn(run_ship_handover, 'watch').mockResolvedValue(async () => false)
	vi.spyOn(run_ship_preflight, 'stage').mockResolvedValue({ code: OK, out: 'ready' })
	vi.spyOn(run_ship_pre_detach_timed, 'checks').mockResolvedValue({ code: OK, out: 'passed' })
	vi.spyOn(run_ship_conflict_probe, 'probe').mockResolvedValue(undefined)
	vi.spyOn(run_ship_detach, 'detach').mockResolvedValue({ verdict: 'busy', note: 'running' })
}

beforeEach(() => {
	stub_stages()
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
	run_ship_recorded_fixture.isolate()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh ship --detach — a re-ship after a review failure or a followup check stop', () => {
	it('hands off without the preflight or the pre-detach checks, saying why', async () => {
		vi.spyOn(run_ship_reship, 'is_due').mockResolvedValue(true)

		await run_ship_cli.run([TITLE, '--detach'])

		expect(run_ship_preflight.stage).not.toHaveBeenCalled()
		expect(run_ship_pre_detach_timed.checks).not.toHaveBeenCalled()
		expect(run_ship_detach.detach).toHaveBeenCalledOnce()
		expect(console.error).toHaveBeenCalledWith(run_ship_reship.SKIP_NOTE)
		expect(run_event_stream_emit.emit).toHaveBeenCalledWith(
			'ship-stage',
			expect.stringContaining(run_ship_reship.SKIP_REASON),
		)
	})

	it('runs both before the hand-off on any other ship', async () => {
		vi.spyOn(run_ship_reship, 'is_due').mockResolvedValue(false)

		await run_ship_cli.run(ARGV)

		expect(run_ship_preflight.stage).toHaveBeenCalledOnce()
		expect(run_ship_pre_detach_timed.checks).toHaveBeenCalledOnce()
		expect(run_ship_detach.detach).toHaveBeenCalledOnce()
		expect(console.error).not.toHaveBeenCalledWith(run_ship_reship.SKIP_NOTE)
	})

	it('keeps a --review ship’s test:pinned and stops on its red', async () => {
		vi.spyOn(run_ship_reship, 'is_due').mockResolvedValue(true)
		vi.mocked(run_ship_pre_detach_timed.checks).mockResolvedValue({ code: RED, out: 'unpinned' })

		expect(await run_ship_cli.run(ARGV)).toBe(RED)
		expect(run_ship_preflight.stage).not.toHaveBeenCalled()
		expect(run_ship_detach.detach).not.toHaveBeenCalled()
	})
})

describe('josh ship — the stop it records', () => {
	it('passes through with_base, so a review failure keeps the base it stopped on', async () => {
		vi.spyOn(run_ship_reship, 'is_due').mockResolvedValue(false)
		vi.mocked(run_ship_pre_detach_timed.checks).mockResolvedValue({ code: RED, out: 'red' })
		vi.spyOn(run_ship_reship, 'with_base').mockImplementation(async (stop) => ({
			...stop,
			base: BASE,
		}))
		const record = vi.spyOn(lane_ledger_write, 'record_stop').mockResolvedValue()

		await run_ship_cli.run(ARGV)

		expect(record).toHaveBeenCalledWith(expect.objectContaining({ base: BASE }))
	})
})
