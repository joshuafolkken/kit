import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_hand_back_held } from '#scripts/lane/lane-hand-back-held'
import { run_investigation_record } from '#scripts/run/run-investigation-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_stage, type ShipState } from './run-ship-stage'
import { run_ship_steps, type ShipArguments, type Step } from './run-ship-steps'
import { run_ship_sync, type WaitMark } from './run-ship-sync'

// joshuafolkken/kit#7121: a lane's merge wait frees its seat, so that — not the detach, after which
// the child still holds the seat — is where a full driver's hand-back mark becomes the seat's hold.

const ISSUE = '7121'
const RECORD = '/stub/record.json'
const OK = { code: 0, out: '' }
const FRESH: ShipState = { is_committed: false, is_pushed: false, is_merged: false }
const ARGS: ShipArguments = {
	title: 'Hold the freed lane',
	number: ISSUE,
	notify: [],
	body: [],
	body_path: undefined,
	cites: [],
	is_review: false,
	is_detach: false,
	unpinned_ok: [],
}

function followup_step(): Step {
	const found = run_ship_steps
		.steps(ARGS)
		.find((step) => step.stage === run_ship_stage.STAGE.FOLLOWUP)

	if (found === undefined) throw new Error('no followup step')

	return found
}

// The followup the stage hands its mark to: the merge wait opens, then closes.
async function waiting_followup(
	_title: string,
	_notify: ReadonlyArray<string>,
	mark?: WaitMark,
): Promise<typeof OK> {
	mark?.(true)
	mark?.(false)

	return OK
}

beforeEach(() => {
	vi.spyOn(run_ship_probe, 'record_target').mockResolvedValue(RECORD)
	vi.spyOn(run_ship_stage, 'mark_merge_waiting').mockReturnValue()
	vi.spyOn(run_ship_sync, 'followup_stage').mockImplementation(waiting_followup)
	vi.spyOn(run_ship_body_draft, 'remove').mockResolvedValue()
	vi.spyOn(run_investigation_record, 'remove').mockResolvedValue()
	vi.spyOn(lane_hand_back_held, 'record').mockResolvedValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_steps — the hand-back hold at a lane’s merge wait', () => {
	it('records the hold once, after the merge wait frees the lane’s seat', async () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)

		await followup_step().run(ARGS, FRESH)

		const [opened] = vi.mocked(run_ship_stage.mark_merge_waiting).mock.invocationCallOrder
		const [held = 0] = vi.mocked(lane_hand_back_held.record).mock.invocationCallOrder

		expect(lane_hand_back_held.record).toHaveBeenCalledOnce()
		expect(opened).toBeLessThan(held)
	})

	it('leaves the mark alone on a ship outside a lane, which frees no seat', async () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(false)

		await followup_step().run(ARGS, FRESH)

		expect(run_ship_stage.mark_merge_waiting).toHaveBeenCalledWith(RECORD, true)
		expect(lane_hand_back_held.record).not.toHaveBeenCalled()
	})
})
