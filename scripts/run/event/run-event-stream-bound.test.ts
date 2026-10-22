import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_board_phase, type Phase } from '#scripts/run/board/run-board-phase'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { afterAll, describe, expect, it } from 'vitest'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_fixture } from './run-event-stream-fixture'

// joshuafolkken/kit#3541: the bound drops a ship-stage `start` after the lines `run:board` draws
// nothing from, so a shipped child's track keeps every stage it passed through.

const KIND = run_event_stream.EVENT_KIND
const { PHASE, STAGE } = run_ship_stage
const AT = '2026-10-09T00:00:00.000Z'
const ISSUE = '#3541'
const OLDER_START = `${ISSUE} review start`
const NEWEST_START = `${ISSUE} gate start`
// The older start, a `done` and a heartbeat, before the issue's newest stage.
const LEADING_COUNT = 4
// The `done` and the heartbeat: the lines that draw nothing.
const SILENT_COUNT = 2
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-event-stream-bound-'))

function fresh_target(): string {
	return path.join(TEMPORARY, `${randomUUID()}.jsonl`)
}

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

function append_many(target: string, kind: string, count: number): void {
	run_event_stream_fixture.fill(target, kind, count, (index) => `#${String(index)} line`)
}

function texts_of(target: string): ReadonlyArray<string> {
	return run_event_stream.read_events(target).map((event) => event.text)
}

// A full stream: the three disposable lines and the issue's newest stage, then positions to the cap.
function full_stream(): string {
	const target = fresh_target()

	run_event_stream.append(target, KIND.SHIP_STAGE, OLDER_START, AT)
	run_event_stream.append(target, KIND.SHIP_STAGE, `${ISSUE} review done`, AT)
	run_event_stream.append(target, KIND.HEARTBEAT, 'beat', AT)
	run_event_stream.append(target, KIND.SHIP_STAGE, NEWEST_START, AT)
	append_many(target, KIND.LANE_PHASE, run_event_stream.EVENT_CAP - LEADING_COUNT)

	return target
}

// A successful ship: every stage starts and is done, a heartbeat after each line.
function append_ship(target: string): void {
	for (const stage of Object.values(STAGE)) {
		for (const phase of [PHASE.START, PHASE.DONE]) {
			run_event_stream.append(target, KIND.SHIP_STAGE, `${ISSUE} ${stage} ${phase}`, AT)
			run_event_stream.append(target, KIND.HEARTBEAT, 'beat', AT)
		}
	}
}

function track_of(target: string): ReadonlyArray<Phase> {
	let track: ReadonlyArray<Phase> = [run_board_phase.LAUNCHED_PHASE]

	for (const event of run_event_stream.read_events(target)) {
		const phase = run_board_phase.phase_of(event)

		if (phase !== undefined) track = run_board_phase.history_after(track, phase)
	}

	return track
}

describe('run_event_stream.append — the bound drops a stage start last', () => {
	it('drops the done and heartbeat lines before an older stage start', () => {
		const target = full_stream()

		append_many(target, KIND.LANE_PHASE, SILENT_COUNT)

		const texts = texts_of(target)

		expect(texts.slice(0, 2)).toStrictEqual([OLDER_START, NEWEST_START])
		expect(texts).toHaveLength(run_event_stream.EVENT_CAP)
	})

	it('drops the older stage start once nothing else is disposable, and keeps the newest', () => {
		const target = full_stream()

		append_many(target, KIND.LANE_PHASE, SILENT_COUNT + 1)

		const texts = texts_of(target)

		expect(texts[0]).toBe(NEWEST_START)
		expect(texts).toHaveLength(run_event_stream.EVENT_CAP)
	})
})

describe('run_event_stream.append — the bound keeps a shipped track', () => {
	it('keeps every post-ship phase on the track of a ship on a full, rolling stream', () => {
		const target = fresh_target()

		append_many(target, KIND.HEARTBEAT, run_event_stream.EVENT_CAP)
		append_ship(target)
		append_many(target, KIND.HEARTBEAT, run_event_stream.EVENT_CAP)

		expect(track_of(target)).toStrictEqual([
			'investigate',
			'ship',
			'review',
			'gate',
			'sync',
			'commit',
			'round_two',
			'followup',
			'report',
		])
	})
})

// joshuafolkken/kit#3770: only a child's newest `pr-checks` is drawn, so a superseded one rolls off
// before any position and the newest is kept.
describe('run_event_stream.append — the bound drops a superseded pr-checks line', () => {
	const position = `${ISSUE} launched`
	const older = `${ISSUE} PR 3765 pass 1 pending 2 fail 0 coderabbit running`
	const newest = `${ISSUE} PR 3765 pass 3 pending 0 fail 0 coderabbit done`

	function checks_stream(filler_count: number): ReadonlyArray<string> {
		const target = fresh_target()

		run_event_stream.append(target, KIND.CHILD_LAUNCH, position, AT)
		run_event_stream.append(target, KIND.PR_CHECKS, older, AT)
		run_event_stream.append(target, KIND.PR_CHECKS, newest, AT)
		append_many(target, KIND.LANE_PHASE, filler_count)

		return texts_of(target)
	}

	it('drops an older pr-checks line before an older position', () => {
		const texts = checks_stream(run_event_stream.EVENT_CAP - 2)

		expect(texts.slice(0, 2)).toStrictEqual([position, newest])
		expect(texts).toHaveLength(run_event_stream.EVENT_CAP)
	})

	it('keeps the newest pr-checks line past a position once the stream rolls again', () => {
		const texts = checks_stream(run_event_stream.EVENT_CAP - 1)

		expect(texts[0]).toBe(newest)
		expect(texts).not.toContain(older)
		expect(texts).toHaveLength(run_event_stream.EVENT_CAP)
	})
})
