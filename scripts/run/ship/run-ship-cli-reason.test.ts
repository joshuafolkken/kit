import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_cli } from './run-ship-cli'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_handover } from './run-ship-handover'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_recorded_fixture } from './run-ship-recorded-fixture'
import { run_ship_stage } from './run-ship-stage'
import { run_ship_steps, type Step } from './run-ship-steps'
import type { StepResult } from './run-ship-sync'

// joshuafolkken/kit#5296: the review stage's event line says why it ran or was skipped. The reasons
// themselves are pinned in `run-ship-review-steps-reuse.test.ts`; here the stage is stubbed.

const OK = 0
const TITLE = 'Record why the ship review stage ran or was skipped #5296'
const REUSED = 'reused: round 1 attested on this branch, its tree held'
const RAN = 'ran: --review with no reusable round 1 — no round 1 recorded'

function review_step(result: StepResult): Step {
	return { stage: run_ship_stage.STAGE.REVIEW, header: '=== review ===', run: async () => result }
}

async function emitted(result: StepResult): Promise<ReadonlyArray<string>> {
	vi.spyOn(run_ship_steps, 'steps').mockReturnValue([review_step(result)])
	await run_ship_cli.run([TITLE, '--review'])

	return vi.mocked(run_event_stream_emit.emit).mock.calls.map(([, text]) => text)
}

// A supervisor whose sync left its code as it was, so no case hands over or writes a real result.
function stub_supervisor(): void {
	vi.stubEnv(run_ship_detach.SUPERVISED_KEY, '1')
	vi.spyOn(run_ship_handover, 'watch').mockResolvedValue(async () => false)
	vi.spyOn(run_ship_probe, 'repository_directory').mockResolvedValue('/repository/kit')
	vi.spyOn(run_ship_detach, 'claim_identity').mockResolvedValue()
	vi.spyOn(run_ship_detach, 'mark_result').mockResolvedValue()
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
	run_ship_recorded_fixture.isolate()
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('josh ship --review — the review stage event line', () => {
	it('ends a reused round 1 skipped, with its reason, never done', async () => {
		const lines = await emitted({
			code: OK,
			out: 'round 1 reused',
			is_skipped: true,
			reason: REUSED,
		})

		expect(lines).toContain(`#5296 review skipped review | ${REUSED}`)
		expect(lines.some((line) => line.includes(' review done'))).toBe(false)
	})

	it('ends a review that ran done, naming its cause', async () => {
		const lines = await emitted({ code: OK, out: 'review clean', reason: RAN })

		expect(lines).toContain(`#5296 review done review | ${RAN}`)
	})
})
