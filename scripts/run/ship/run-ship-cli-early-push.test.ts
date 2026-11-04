import { deferred_answer } from '#scripts/git/deferred-answer-fixture'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { early_push_record } from '#scripts/run/early-push-record'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_cli } from './run-ship-cli'
import { run_ship_handover } from './run-ship-handover'
import { run_ship_preflight } from './run-ship-preflight'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_recorded_fixture } from './run-ship-recorded-fixture'
import { run_ship_review_steps } from './run-ship-review-steps'
import { run_ship_scoped } from './run-ship-scoped'
import { run_ship_sync } from './run-ship-sync'

const TITLE = 'Overlap CI #6251'
const OK = { code: 0, out: '' }
const COMMITTED = { is_committed: true, is_pushed: false, is_merged: false }
const SKIP_COMMIT = '--skip-commit'
const REVIEW_METHOD = 'round_two_stage'
const RUN_METHOD = 'josh_run'

beforeEach(() => {
	vi.spyOn(run_ship_body_draft, 'with_draft').mockImplementation(async (args) => args)
	vi.spyOn(run_ship_body_draft, 'remove').mockResolvedValue()
	vi.spyOn(early_push_record, 'record').mockResolvedValue()
	vi.spyOn(run_ship_probe, 'record_target').mockResolvedValue(undefined)
	vi.spyOn(run_ship_handover, 'watch').mockResolvedValue(async () => false)
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(false)
	vi.spyOn(console, 'info').mockReturnValue()
	run_ship_recorded_fixture.isolate()
})

function stub_stages(): void {
	vi.spyOn(run_ship_preflight, 'stage').mockResolvedValue(OK)
	vi.spyOn(run_ship_sync, 'sync_stage').mockResolvedValue(OK)
	vi.spyOn(run_ship_sync, 'catch_up').mockResolvedValue(undefined)
	vi.spyOn(run_ship_sync, 'followup_stage').mockResolvedValue(OK)
	vi.spyOn(run_ship_review_steps, 'review_stage').mockResolvedValue(OK)
	vi.spyOn(run_ship_scoped, 'scoped_gate').mockResolvedValue(OK)
	vi.spyOn(run_ship_scoped, 'is_gate_green').mockResolvedValue(false)
}

function setup_push(): {
	state: typeof COMMITTED
	pushed: Promise<boolean>
	commands: Array<ReadonlyArray<string>>
} {
	const state = { ...COMMITTED }
	const pushed = deferred_answer<boolean>()
	const commands: Array<ReadonlyArray<string>> = []

	vi.spyOn(run_ship_probe, 'read_state').mockImplementation(async () => ({ ...state }))
	vi.spyOn(josh_command, RUN_METHOD).mockImplementation(async (argv) => {
		commands.push(argv)
		state.is_pushed = true
		pushed.answer(true)

		return OK
	})

	return { state, pushed: pushed.promise, commands }
}

function start_review(): { running: Promise<number>; finish: () => void } {
	stub_stages()
	const review = deferred_answer<typeof OK>()

	vi.spyOn(run_ship_review_steps, REVIEW_METHOD).mockReturnValue(review.promise)

	return {
		running: run_ship_cli.run([TITLE, '--review']),
		finish: () => {
			review.answer(OK)
		},
	}
}

function assert_commit(commands: ReadonlyArray<ReadonlyArray<string>>, is_changed: boolean): void {
	expect(commands[1]).toStrictEqual(
		is_changed ? ['git', '-y', TITLE] : ['git', '-y', SKIP_COMMIT, '--skip-push', TITLE],
	)
	expect(run_ship_sync.followup_stage).toHaveBeenCalledOnce()
}

afterEach(() => vi.restoreAllMocks())

describe('ship CI overlaps the final review', () => {
	it.each([false, true])(
		'pushes before round 2 ends and pushes again only for its changes: %s',
		async (is_changed) => {
			const { state, pushed, commands } = setup_push()
			const { running, finish } = start_review()

			await pushed
			expect(commands).toStrictEqual([['git', '-y', SKIP_COMMIT, TITLE]])
			expect(run_ship_sync.followup_stage).not.toHaveBeenCalled()
			state.is_committed = !is_changed
			finish()
			expect(await running).toBe(0)
			assert_commit(commands, is_changed)
		},
	)
})
