import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import { run_wake_takeover } from '#scripts/run/wake/run-wake-takeover'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_cli } from './run-ship-cli'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_handover } from './run-ship-handover'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_recorded_fixture } from './run-ship-recorded-fixture'
import { run_ship_relaunch } from './run-ship-relaunch'
import { run_ship_stage } from './run-ship-stage'
import { run_ship_steps, type Step } from './run-ship-steps'

// joshuafolkken/kit#4849: a supervisor whose sync changed its own code hands the stages after the sync
// to a successor on that code, and leaves the launch's result to it; the stages are stubbed here, their
// own branches pinned in `run-ship-steps.test.ts`.

const OK = 0
const TITLE = 'Hand a ship to a supervisor on the new code #4849'
const REPOSITORY = '/repository/kit'
const SUCCESSOR_PID = 2222
const { STAGE } = run_ship_stage

function stub(stage: Step['stage']): Step {
	return { stage, header: `=== ${stage} ===`, run: vi.fn(async () => ({ code: OK, out: stage })) }
}

const stages = { sync: stub(STAGE.SYNC), review: stub(STAGE.REVIEW) }

function supervise(is_changed: boolean): void {
	vi.spyOn(run_ship_handover, 'watch').mockResolvedValue(async () => is_changed)
}

// The supervisor's own record and its successor, so no case launches a process or writes a record.
function stub_supervisor(): void {
	vi.spyOn(run_ship_probe, 'repository_directory').mockResolvedValue(REPOSITORY)
	vi.spyOn(run_ship_relaunch, 'relaunch').mockReturnValue(SUCCESSOR_PID)
	vi.spyOn(run_wake_takeover, 'await_takeover').mockResolvedValue('taken')
	vi.spyOn(run_ship_detach, 'claim_identity').mockResolvedValue()
	vi.spyOn(run_ship_detach, 'mark_result').mockResolvedValue()
}

beforeEach(() => {
	vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '1')
	vi.spyOn(run_ship_steps, 'steps').mockReturnValue([stages.sync, stages.review])
	vi.spyOn(run_ship_probe, 'record_target').mockResolvedValue(undefined)
	vi.spyOn(run_ship_probe, 'read_state').mockResolvedValue({
		is_committed: false,
		is_pushed: false,
		is_merged: false,
	})
	stub_supervisor()
	vi.spyOn(lane_ledger_write, 'record_stage').mockResolvedValue()
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(console, 'info').mockReturnValue()
	run_ship_recorded_fixture.isolate()
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	vi.mocked(stages.review.run).mockClear()
})

describe('josh ship — a supervisor whose sync changed its code', () => {
	it('hands over after the sync, running no review and writing no result', async () => {
		supervise(true)

		expect(await run_ship_cli.run([TITLE, '--review'])).toBe(OK)
		expect(stages.review.run).not.toHaveBeenCalled()
		expect(run_ship_detach.mark_result).not.toHaveBeenCalled()
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('=== handover ==='))
	})

	it('runs the review itself and writes its result where the sync left its code as it was', async () => {
		supervise(false)

		expect(await run_ship_cli.run([TITLE, '--review'])).toBe(OK)
		expect(run_ship_relaunch.relaunch).not.toHaveBeenCalled()
		expect(stages.review.run).toHaveBeenCalledOnce()
		expect(run_ship_detach.mark_result).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#4974: a reason an earlier run on this branch accepted is the ship's --unpinned-ok.
describe('josh ship — a --review ship given no reason', () => {
	it("runs its stages under the branch's recorded reason", async () => {
		supervise(false)
		vi.mocked(run_review_pinned_accepted.recorded_reason).mockResolvedValue('only logs')

		await run_ship_cli.run([TITLE, '--review'])

		expect(run_ship_steps.steps).toHaveBeenCalledWith(
			expect.objectContaining({ unpinned_ok: ['--unpinned-ok', 'only logs'] }),
		)
	})
})
