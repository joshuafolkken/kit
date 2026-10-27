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

// joshuafolkken/kit#5018: a branch that conflicts with origin/main ran the whole pre-detach first, and
// the supervisor's sync then stopped on the conflict, throwing those checks away. The probe's own
// branches are pinned with real git in `run-ship-conflict-probe.test.ts`; here it is stubbed.

const OK = 0
const FAILED = 1
const TITLE = 'Probe for a conflict before the pre-detach checks #5018'
const CONFLICTED = 'docs/maintainers/josh-commands-rationale.md'

function conflict_found(): void {
	vi.spyOn(run_ship_conflict_probe, 'probe').mockResolvedValue({
		code: FAILED,
		out: CONFLICTED,
		conflicts: [CONFLICTED],
	})
}

// The ship's record and the stages before the hand-off: a fresh record, a passing preflight and checks.
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
	vi.spyOn(run_ship_detach, 'detach').mockResolvedValue({ verdict: 'launched', note: 'pid 1' })
}

beforeEach(() => {
	stub_stages()
	vi.spyOn(lane_ledger_write, 'record_stop').mockResolvedValue()
	vi.spyOn(lane_ledger_write, 'record_stage').mockResolvedValue()
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
	run_ship_recorded_fixture.isolate()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh ship --detach — a conflict with origin/main', () => {
	it('stops naming the file without running the pre-detach checks or detaching', async () => {
		conflict_found()

		expect(await run_ship_cli.run([TITLE, '--detach'])).toBe(FAILED)
		expect(run_ship_pre_detach_timed.checks).not.toHaveBeenCalled()
		expect(run_ship_detach.detach).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(CONFLICTED))
	})

	it('records the stop as a conflict', async () => {
		conflict_found()

		await run_ship_cli.run([TITLE, '--detach'])

		expect(vi.mocked(lane_ledger_write.record_stop).mock.calls[0]?.[0].reason).toBe('conflict')
	})
})

describe('josh ship --detach — no conflict with origin/main', () => {
	it('runs the pre-detach checks and detaches as before', async () => {
		expect(await run_ship_cli.run([TITLE, '--detach'])).toBe(OK)
		expect(run_ship_pre_detach_timed.checks).toHaveBeenCalledOnce()
		expect(run_ship_detach.detach).toHaveBeenCalledOnce()
		expect(lane_ledger_write.record_stop).not.toHaveBeenCalled()
	})
})
