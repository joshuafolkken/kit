import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage, type Stage } from '#scripts/run/ship/run-ship-stage'
import { afterAll, describe, expect, it } from 'vitest'
import { run_board_status, type ItemStatus } from './run-board-status'

// joshuafolkken/kit#3552: on a stream the positions fill to `EVENT_CAP`, only each issue's newest
// ship-stage line survives, so that line alone has to draw the attempt's whole track.

const KIND = run_event_stream.EVENT_KIND
const { PHASE, STAGE } = run_ship_stage
const AT = '2026-10-09T00:00:00.000Z'
const ISSUE = '3552'
const CITE = `#${ISSUE}`
// The launch, the first edit, the ship launch and the merge — the positions the child itself writes.
const OWN_POSITIONS = 4
const RUN_STAGES: ReadonlyArray<Stage> = [
	STAGE.PREFLIGHT,
	STAGE.REVIEW,
	STAGE.SYNC,
	STAGE.GATE,
	STAGE.COMMIT,
	STAGE.ROUND_TWO,
	STAGE.FOLLOWUP,
]
const SHIPPED_TRACK = ['investigate', 'implement', 'ship', 'review', 'sync', 'gate', 'commit']
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-board-status-saturated-'))

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

// A stream whose positions leave one slot free, with the child launched and implementing on it.
function saturated(): string {
	const target = path.join(TEMPORARY, `${randomUUID()}.jsonl`)

	run_event_stream.append(target, KIND.CHILD_LAUNCH, `${CITE} launched`, AT)
	run_event_stream.append(target, KIND.LANE_PHASE, `${CITE} implement`, AT)

	for (let index = 0; index < run_event_stream.EVENT_CAP - OWN_POSITIONS - 1; index += 1) {
		run_event_stream.append(target, KIND.LANE_PHASE, '#1 implement', AT)
	}

	return target
}

// The lines `josh ship` writes for one stage, carrying the attempt so far.
function run_stage(target: string, stage: Stage, started: Array<Stage>, is_green = true): void {
	started.push(stage)

	for (const phase of [PHASE.START, is_green ? PHASE.DONE : PHASE.FAILED]) {
		const text = run_ship_stage.event_text(ISSUE, stage, phase, started)

		run_event_stream.append(target, KIND.SHIP_STAGE, text, AT)
	}
}

function run_stages(target: string, stages: ReadonlyArray<Stage>, started: Array<Stage>): void {
	for (const stage of stages) {
		run_stage(target, stage, started)

		if (stage === STAGE.PREFLIGHT) {
			run_event_stream.append(target, KIND.SHIP_LAUNCH, `${CITE} ship supervisor launched`, AT)
		}
	}
}

function status_of(target: string): ItemStatus | undefined {
	const events: ReadonlyArray<RunEvent> = run_event_stream.read_events(target)

	return run_board_status.statuses_of(events, [], new Set()).get(Number(ISSUE))
}

describe('run_board_status — a ship on a stream full of positions', () => {
	it('draws every stage a merged child started, the report after its merge too', () => {
		const target = saturated()
		const started: Array<Stage> = []

		run_stages(target, RUN_STAGES, started)
		run_event_stream.append(target, KIND.MERGE, `${CITE} merged`, AT)
		run_stage(target, STAGE.REPORT, started)

		expect(status_of(target)).toMatchObject({
			state: 'merged',
			track: [...SHIPPED_TRACK, 'round_two', 'followup', 'report'],
		})
		expect(run_event_stream.read_events(target)).toHaveLength(run_event_stream.EVENT_CAP)
	})

	it('draws the stages a child still shipping has started', () => {
		const target = saturated()

		run_stages(target, RUN_STAGES.slice(0, RUN_STAGES.indexOf(STAGE.COMMIT) + 1), [])

		expect(status_of(target)).toMatchObject({ state: 'running', track: SHIPPED_TRACK })
	})

	it('still folds a failed attempt into the ship and its failure', () => {
		const target = saturated()
		const started: Array<Stage> = []

		run_stages(target, [STAGE.PREFLIGHT, STAGE.REVIEW], started)
		run_stage(target, STAGE.GATE, started, false)
		run_event_stream.append(target, KIND.SHIP_STOP, `${CITE} gate failed`, AT)

		expect(status_of(target)?.track).toStrictEqual(['investigate', 'implement', 'ship', 'failed'])
	})

	it('still reads an older three-word stage line one phase at a time', () => {
		const target = saturated()

		run_event_stream.append(target, KIND.SHIP_STAGE, `${CITE} review start`, AT)

		expect(status_of(target)?.track).toStrictEqual(['investigate', 'implement', 'review'])
	})
})

describe('run_board_status — a ship whose launch the stream rolled off', () => {
	it('starts the track of a resumed child whose launch has rolled off', () => {
		const target = path.join(TEMPORARY, `${randomUUID()}.jsonl`)
		const text = run_ship_stage.event_text(ISSUE, STAGE.REVIEW, PHASE.START, [
			STAGE.PREFLIGHT,
			STAGE.REVIEW,
		])

		run_event_stream.append(target, KIND.RESUME, CITE, AT)
		run_event_stream.append(target, KIND.SHIP_STAGE, text, AT)

		expect(status_of(target)).toMatchObject({ state: 'running', track: ['ship', 'review'] })
	})
})
