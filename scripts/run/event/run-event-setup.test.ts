import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { run_event_scope } from './run-event-scope'
import { run_event_setup } from './run-event-setup'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// joshuafolkken/kit#3696: the stages of a run's start, each one `setup` event. Pinned here — the words
// each stage writes, that only a lane opening names an issue, that the event is a trace the position
// readers skip, that the bound drops every stage but the newest first, and that a stage which cannot be
// written fails nothing.

const KIND = run_event_stream.EVENT_KIND
const REPOSITORY = '/repo/.git'
const AT = '2026-10-12T09:00:00.000Z'
const MERGED = '#7 merged'
const STREAM_GONE = 'the stream is gone'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-event-setup-'))

const OPENING_278 = run_event_setup.opening_lane('278')
// The stages the roll-off test writes ahead of its notes: the older one is the stream's one excess line.
const STAGES_WRITTEN = 2

// A stream of positions alone — a note rolls off only with them — as this repository's live one is.
function fill(target: string, count: number): void {
	for (let index = 0; index < count; index += 1) {
		run_event_stream.append(target, KIND.NOTE, `note ${String(index)}`, AT)
	}
}

function stages_on(target: string): Array<string> {
	return run_event_stream
		.read_events(target)
		.filter((event) => event.kind === KIND.SETUP)
		.map((event) => event.text)
}

function fresh_target(): string {
	return path.join(TEMPORARY, `${randomUUID()}.jsonl`)
}

// The stream `emit_in` writes for `REPOSITORY`, pointed at a file of this suite's own.
function stage_target(): string {
	const target = fresh_target()

	vi.spyOn(run_event_stream, 'target_of').mockReturnValue(target)

	return target
}

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('run_event_setup stages', () => {
	it('names each stage in the words the board draws', () => {
		expect(run_event_setup.STAGE).toStrictEqual({
			STARTING: 'starting session',
			PLANNING: 'planning',
			HANDING_OFF: 'handing off',
		})
		expect(run_event_setup.opening_lane('278')).toBe('opening lane #278')
	})

	it('names an issue only where a lane opens', () => {
		const named = [...Object.values(run_event_setup.STAGE), run_event_setup.opening_lane('278')]
			.map((text) => ({ pos: 1, at: AT, kind: KIND.SETUP, text }))
			.map((event) => run_event_scope.issue_named(event))

		expect(named).toStrictEqual([undefined, undefined, undefined, '278'])
	})
})

describe('run_event_setup.emit', () => {
	it('appends the stage as a setup event to the run’s own stream', async () => {
		const emit = vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()

		await run_event_setup.emit(run_event_setup.STAGE.PLANNING)

		expect(emit).toHaveBeenCalledExactlyOnceWith(KIND.SETUP, 'planning')
	})
})

describe('run_event_setup.emit_in', () => {
	it('writes the stage to the repository’s stream, dated the moment it was handed', () => {
		const target = stage_target()

		run_event_setup.emit_in(REPOSITORY, run_event_setup.STAGE.STARTING, new Date(AT))

		expect(run_event_stream.target_of).toHaveBeenCalledWith(REPOSITORY)
		expect(run_event_stream.read_events(target)).toStrictEqual([
			{ pos: 1, at: AT, kind: KIND.SETUP, text: run_event_setup.STAGE.STARTING },
		])
	})

	it('swallows a stream that cannot be written rather than failing the launch', () => {
		vi.spyOn(run_event_stream, 'target_of').mockImplementation(() => {
			throw new Error(STREAM_GONE)
		})

		expect(() => {
			run_event_setup.emit_in(REPOSITORY, run_event_setup.STAGE.STARTING, new Date(AT))
		}).not.toThrow()
	})
})

describe('a setup event on the stream', () => {
	it('is a trace: the run’s position stays where it was', () => {
		const target = stage_target()

		run_event_stream.append(target, KIND.MERGE, MERGED, AT)
		run_event_setup.emit_in(REPOSITORY, run_event_setup.opening_lane('8'), new Date(AT))

		expect(run_event_stream.TRACE_KINDS.has(KIND.SETUP)).toBe(true)
		expect(run_event_stream.read_last(target)?.text).toBe(MERGED)
	})

	it('rolls off before a position once a newer stage stands on a full stream', () => {
		const target = stage_target()

		run_event_stream.append(target, KIND.MERGE, MERGED, AT)
		run_event_setup.emit_in(REPOSITORY, run_event_setup.STAGE.STARTING, new Date(AT))
		run_event_setup.emit_in(REPOSITORY, run_event_setup.STAGE.PLANNING, new Date(AT))
		fill(target, run_event_stream.EVENT_CAP - STAGES_WRITTEN)

		const events = run_event_stream.read_events(target)

		expect(events).toHaveLength(run_event_stream.EVENT_CAP)
		expect(stages_on(target)).toStrictEqual([run_event_setup.STAGE.PLANNING])
		expect(events[0]?.text).toBe(MERGED)
	})
})

describe('a setup event on a stream the positions already fill', () => {
	it('survives its own append', () => {
		const target = stage_target()

		fill(target, run_event_stream.EVENT_CAP)
		run_event_setup.emit_in(REPOSITORY, run_event_setup.STAGE.STARTING, new Date(AT))

		expect(run_event_stream.read_events(target)).toHaveLength(run_event_stream.EVENT_CAP)
		expect(stages_on(target)).toStrictEqual([run_event_setup.STAGE.STARTING])
	})

	it('leaves only the newest of a run’s stages', () => {
		const target = stage_target()

		fill(target, run_event_stream.EVENT_CAP)

		for (const stage of [...Object.values(run_event_setup.STAGE), OPENING_278]) {
			run_event_setup.emit_in(REPOSITORY, stage, new Date(AT))
		}

		expect(stages_on(target)).toStrictEqual([OPENING_278])
	})
})
