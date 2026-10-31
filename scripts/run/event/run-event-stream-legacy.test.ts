import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_board_status } from '#scripts/run/board/run-board-status'
import { afterAll, describe, expect, it } from 'vitest'
import { run_event_stream } from './run-event-stream'

// joshuafolkken/kit#3689: the `idle` kind is retired, and a stream a previous version wrote may still
// hold its lines. Such a line reads as no event — not a position, not the run's newest activity — and
// the next append drops it without handing its position to a new event.

const KIND = run_event_stream.EVENT_KIND
const LAUNCHED_AT = '2026-10-12T05:26:00.000Z'
// The legacy line is the newer one, as a poll during the wait wrote it.
const POLLED_AT = '2026-10-12T11:00:00.000Z'
const LEGACY_KIND = 'idle'
const LEGACY_POSITION = 2
const LAUNCH = '#3689 launched'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-event-stream-legacy-'))

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

// A stream of one launch, then a line of the retired kind appended as a previous version left it.
function legacy_stream(): string {
	const target = path.join(TEMPORARY, `${randomUUID()}.jsonl`)
	const legacy = { pos: LEGACY_POSITION, at: POLLED_AT, kind: LEGACY_KIND, text: 'idle window' }

	run_event_stream.append(target, KIND.CHILD_LAUNCH, LAUNCH, LAUNCHED_AT)
	appendFileSync(target, `${JSON.stringify(legacy)}\n`)

	return target
}

describe('run_event_stream — a line of the retired idle kind', () => {
	it('reads as no event to every reader', () => {
		const target = legacy_stream()

		expect(run_event_stream.read_events(target).map((event) => event.text)).toStrictEqual([LAUNCH])
		expect(run_event_stream.read_last(target)?.text).toBe(LAUNCH)
		expect(run_event_stream.read_from(target, 0)).toMatchObject({
			events: [{ text: LAUNCH }],
			next_position: 1,
		})
	})

	it('leaves the run’s newest activity at its last real event', () => {
		const events = run_event_stream.read_events(legacy_stream())

		expect(run_board_status.activity_of(events)).toStrictEqual({
			setup: undefined,
			setup_ms: undefined,
			last_event_ms: Date.parse(LAUNCHED_AT),
			latest: { text: LAUNCH, at_ms: Date.parse(LAUNCHED_AT) },
			idle_ms: Date.parse(LAUNCHED_AT),
			is_stopped: false,
			lane_events: new Map(),
			pr_checks: new Map(),
			first_lane_ms: undefined,
		})
	})

	it('is dropped by the next append, which takes a position above the legacy line’s', () => {
		const target = legacy_stream()
		const result = run_event_stream.append(target, KIND.MERGE, '#3689 merged', POLLED_AT)

		expect(result).toStrictEqual({ appended: true, position: LEGACY_POSITION + 1 })
		expect(readFileSync(target, 'utf8')).not.toContain(`"kind":"${LEGACY_KIND}"`)
		expect(run_event_stream.read_from(target, 1).events.map((event) => event.pos)).toStrictEqual([
			LEGACY_POSITION + 1,
		])
	})
})
