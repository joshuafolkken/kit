import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship } from './run-ship'
import { run_ship_preflight } from './run-ship-preflight'
import { run_ship_review_steps } from './run-ship-review-steps'
import { run_ship_scoped } from './run-ship-scoped'
import { run_ship_stage, type ShipState } from './run-ship-stage'
import { run_ship_steps, type ShipArguments, type Step } from './run-ship-steps'
import { run_ship_sync } from './run-ship-sync'

const OK: JoshResult = { code: 0, out: '' }
const FAILED: JoshResult = { code: 1, out: '' }
const ISSUE = '2989'
const TITLE = 'Add tests'
const BODY_PATH = '/stub/body.md'

const ARGS: ShipArguments = {
	title: TITLE,
	number: ISSUE,
	notify: ['--notify', 'done'],
	body: ['--body', 'text'],
	body_path: BODY_PATH,
	cites: ['--cite', '#1'],
	is_review: false,
	is_detach: false,
}

const FRESH: ShipState = { is_committed: false, is_pushed: false, is_merged: false }
const { STAGE } = run_ship_stage

const josh_spy = vi.spyOn(josh_command, 'josh_run')
const preflight_spy = vi.spyOn(run_ship_preflight, 'stage')
const scoped_gate_spy = vi.spyOn(run_ship_scoped, 'scoped_gate')
const gate_green_spy = vi.spyOn(run_ship_scoped, 'is_gate_green')
const review_spy = vi.spyOn(run_ship_review_steps, 'review_stage')
const round_two_spy = vi.spyOn(run_ship_review_steps, 'round_two_stage')
const sync_spy = vi.spyOn(run_ship_sync, 'sync_stage')
const followup_spy = vi.spyOn(run_ship_sync, 'followup_stage')

beforeEach(() => {
	josh_spy.mockReset().mockResolvedValue(OK)
	preflight_spy.mockReset().mockResolvedValue(OK)
	scoped_gate_spy.mockReset().mockResolvedValue(OK)
	gate_green_spy.mockReset().mockResolvedValue(false)
	review_spy.mockReset().mockResolvedValue(OK)
	round_two_spy.mockReset().mockResolvedValue(OK)
})

function step_for(stage: string, args: ShipArguments = ARGS): Step {
	const found = run_ship_steps
		.steps({ ...args, is_review: true })
		.find((step) => step.stage === stage)

	if (found === undefined) throw new Error(`no step for ${stage}`)

	return found
}

describe('run_ship_steps.steps — the order a change ships in', () => {
	it('runs preflight, gate, commit, followup and report without --review', () => {
		expect(run_ship_steps.steps(ARGS).map((step) => [step.stage, step.header])).toStrictEqual([
			[STAGE.PREFLIGHT, run_ship.PREFLIGHT_HEADER],
			[STAGE.SYNC, run_ship.SYNC_HEADER],
			[STAGE.GATE, run_ship.GATE_HEADER],
			[STAGE.COMMIT, run_ship.COMMIT_HEADER],
			[STAGE.FOLLOWUP, run_ship.FOLLOWUP_HEADER],
			[STAGE.REPORT, run_ship.REPORT_HEADER],
		])
	})

	it('puts round 1 before the gate and round 2 between commit and followup with --review', () => {
		const stages = run_ship_steps.steps({ ...ARGS, is_review: true }).map((step) => step.stage)

		expect(stages).toStrictEqual([
			STAGE.PREFLIGHT,
			STAGE.REVIEW,
			STAGE.SYNC,
			STAGE.GATE,
			STAGE.COMMIT,
			STAGE.ROUND_TWO,
			STAGE.FOLLOWUP,
			STAGE.REPORT,
		])
	})

	it('always starts with the exported preflight step', () => {
		expect(run_ship_steps.steps(ARGS)[0]).toBe(run_ship_steps.PREFLIGHT_STEP)
	})
})

describe('run_ship_steps — preflight and review stages delegate', () => {
	it('preflight asks with the title and body path', async () => {
		expect(await run_ship_steps.PREFLIGHT_STEP.run(ARGS, FRESH)).toBe(OK)
		expect(preflight_spy).toHaveBeenCalledWith({ title: TITLE, body_path: BODY_PATH })
	})

	it('round 1 and round 2 run the review stages for the issue number', async () => {
		await step_for(STAGE.REVIEW).run(ARGS, FRESH)
		await step_for(STAGE.ROUND_TWO).run(ARGS, FRESH)

		expect(review_spy).toHaveBeenCalledWith(ISSUE)
		expect(round_two_spy).toHaveBeenCalledWith(ISSUE)
	})
})

describe('run_ship_steps — the gate stage', () => {
	it('delegates to the scoped gate and returns its result', async () => {
		scoped_gate_spy.mockResolvedValue(FAILED)

		expect(await step_for(STAGE.GATE).run(ARGS, FRESH)).toStrictEqual({
			...FAILED,
			is_skipped: false,
		})
		expect(scoped_gate_spy).toHaveBeenCalledOnce()
	})

	// joshuafolkken/kit#3643: a gate that reused the green record ran no check, so it is not timed as one.
	it('marks the stage skipped when the tree already had a green gate record', async () => {
		gate_green_spy.mockResolvedValue(true)

		expect(await step_for(STAGE.GATE).run(ARGS, FRESH)).toStrictEqual({ ...OK, is_skipped: true })
		expect(scoped_gate_spy).toHaveBeenCalledOnce()
	})
})

describe('run_ship_steps — the commit, followup and report stages', () => {
	it('commits with no skip flags on a fresh state', async () => {
		await step_for(STAGE.COMMIT).run(ARGS, FRESH)

		expect(josh_spy).toHaveBeenCalledWith(['git', '-y', '--body', 'text', TITLE], true)
	})

	it('carries the skip flags a resumed ship needs', async () => {
		const state = { ...FRESH, is_committed: true, is_pushed: true }

		await step_for(STAGE.COMMIT).run(ARGS, state)

		expect(josh_spy).toHaveBeenCalledWith(
			['git', '-y', '--skip-commit', '--skip-push', '--body', 'text', TITLE],
			true,
		)
	})

	it('followup passes the title and notify flags; report passes the number and cites', async () => {
		await step_for(STAGE.FOLLOWUP).run(ARGS, FRESH)
		await step_for(STAGE.REPORT).run(ARGS, FRESH)

		expect(josh_spy.mock.calls).toStrictEqual([
			[['followup', TITLE, '--notify', 'done'], true],
			[['run:tail', ISSUE, '--cite', '#1'], true],
		])
	})

	// joshuafolkken/kit#3221: the merge of the default branch before the commit.
	it('sync and followup delegate to the sync module', async () => {
		sync_spy.mockResolvedValue(OK)
		followup_spy.mockResolvedValue(OK)

		expect(await step_for(STAGE.SYNC).run(ARGS, FRESH)).toBe(OK)
		expect(await step_for(STAGE.FOLLOWUP).run(ARGS, FRESH)).toBe(OK)
		expect(followup_spy).toHaveBeenCalledWith(TITLE, ARGS.notify)
	})
})
