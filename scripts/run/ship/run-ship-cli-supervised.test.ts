import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_cli } from './run-ship-cli'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_handover } from './run-ship-handover'
import { run_ship_lane_close } from './run-ship-lane-close'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_recorded_fixture } from './run-ship-recorded-fixture'
import { run_ship_stage } from './run-ship-stage'
import { run_ship_steps } from './run-ship-steps'

// The detached supervisor's bookkeeping as `josh ship` drives it: the identity claim before the first
// stage, the result after the last, then the lane close on success. The close itself is pinned in
// `run-ship-lane-close.test.ts`; here it is stubbed so no test closes the lane it runs in.

const OK = 0
const FAILED = 1
const TITLE = 'Fold the ship region #2398'
const NUMBER = '2398'
const REPOSITORY = '/repository/kit'

function stub_stage(code: number, calls: Array<string> = []): void {
	const run = vi.fn(async () => {
		calls.push('stage')

		return { code, out: 'gate result' }
	})

	vi.spyOn(run_ship_steps, 'steps').mockReturnValue([
		{ stage: run_ship_stage.STAGE.GATE, header: '=== gate ===', run },
	])
}

// A supervisor whose sync left its code as it was, so no case hands over or closes a real lane.
function stub_supervisor(): void {
	vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '1')
	vi.spyOn(run_ship_handover, 'watch').mockResolvedValue(async () => false)
	vi.spyOn(run_ship_probe, 'repository_directory').mockResolvedValue(REPOSITORY)
	vi.spyOn(run_ship_detach, 'claim_identity').mockResolvedValue()
	vi.spyOn(run_ship_detach, 'mark_result').mockResolvedValue()
	vi.spyOn(run_ship_lane_close, 'close_merged').mockResolvedValue()
}

beforeEach(() => {
	stub_supervisor()
	vi.spyOn(run_ship_probe, 'record_target').mockResolvedValue(undefined)
	vi.spyOn(run_ship_probe, 'read_state').mockResolvedValue({
		is_committed: false,
		is_pushed: false,
		is_merged: false,
	})
	vi.spyOn(lane_ledger_write, 'record_stage').mockResolvedValue()
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
	run_ship_recorded_fixture.isolate()
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('run_ship_cli.run — supervised completion', () => {
	it.each([OK, FAILED])('records the supervisor result for exit code %s', async (code) => {
		stub_stage(code)

		expect(await run_ship_cli.run([TITLE])).toBe(code)
		expect(run_ship_detach.mark_result).toHaveBeenCalledWith(REPOSITORY, NUMBER, code)
	})

	// joshuafolkken/kit#2642: the supervisor names itself before any stage, so a launcher that could not
	// read its start time never leaves a bare pid to be believed.
	it('claims the supervisor identity before the first stage runs', async () => {
		const calls: Array<string> = []

		vi.mocked(run_ship_detach.claim_identity).mockImplementation(async () => {
			calls.push('claim')
		})
		stub_stage(OK, calls)
		await run_ship_cli.run([TITLE])

		expect(run_ship_detach.claim_identity).toHaveBeenCalledWith(REPOSITORY, NUMBER)
		expect(calls).toStrictEqual(['claim', 'stage'])
	})

	it('claims nothing outside a supervisor', async () => {
		vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '')
		stub_stage(OK)
		await run_ship_cli.run([TITLE])

		expect(run_ship_detach.claim_identity).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#9038: the ship closes its lane after it writes the result, never before.
describe('run_ship_cli.run — the lane close after a merged ship', () => {
	it('closes the lane after recording a successful result', async () => {
		stub_stage(OK)
		await run_ship_cli.run([TITLE])

		const [marked] = vi.mocked(run_ship_detach.mark_result).mock.invocationCallOrder
		const [closed] = vi.mocked(run_ship_lane_close.close_merged).mock.invocationCallOrder

		expect(run_ship_lane_close.close_merged).toHaveBeenCalledWith(NUMBER)
		expect(closed).toBeGreaterThan(marked ?? Infinity)
	})

	it('keeps the lane when the ship failed', async () => {
		stub_stage(FAILED)
		await run_ship_cli.run([TITLE])

		expect(run_ship_lane_close.close_merged).not.toHaveBeenCalled()
	})
})
