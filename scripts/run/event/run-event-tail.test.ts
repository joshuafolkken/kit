import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_event_tail } from './run-event-tail'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#7258: `run:board` reads the stream incrementally. Every case pins the incremental
// read to the whole read (`run_event_stream.read_events`) after an append, a truncation and a
// replacement, and that an append parses only the appended text.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-11-11T00:00:00.000Z'
const TEMPORARY = make_directory('josh-run-event-tail-')

function fresh_target(): string {
	return path.join(TEMPORARY, `${randomUUID()}.jsonl`)
}

function event(pos: number): RunEvent {
	return { pos, at: AT, kind: KIND.MERGE, text: `#${String(pos)} merged` }
}

function lines(positions: ReadonlyArray<number>): string {
	return positions.map((pos) => `${JSON.stringify(event(pos))}\n`).join('')
}

function expect_whole(target: string): void {
	expect(run_event_tail.read_events(target)).toEqual(run_event_stream.read_events(target))
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_event_tail.read_events — an append', () => {
	it('agrees with the whole read after each append', () => {
		const target = fresh_target()

		run_event_stream.append(target, KIND.PLAN, 'planned', AT)
		expect_whole(target)
		run_event_stream.append(target, KIND.MERGE, '#7 merged', AT)
		run_event_stream.append(target, KIND.CHILD_LAUNCH, 'launched #8', AT)
		expect_whole(target)
		expect(run_event_tail.read_events(target)).toHaveLength(3)
	})

	it('parses only the appended line', () => {
		const target = fresh_target()

		stamp_file.replace_text_stamp(target, lines([1, 2]))
		run_event_tail.read_events(target)
		stamp_file.replace_text_stamp(target, lines([1, 2, 3]))
		const parse = vi.spyOn(run_event_stream, 'events_of_text')

		expect(run_event_tail.read_events(target)).toEqual([event(1), event(2), event(3)])
		expect(parse).toHaveBeenCalledWith(lines([3]))
	})

	it('reuses the parsed events while nothing was appended', () => {
		const target = fresh_target()

		stamp_file.replace_text_stamp(target, lines([1, 2]))
		const first = run_event_tail.read_events(target)

		expect(run_event_tail.read_events(target)).toBe(first)
	})
})

describe('run_event_tail.read_events — a truncation or a replacement', () => {
	it('agrees with the whole read after the file shrinks', () => {
		const target = fresh_target()

		stamp_file.replace_text_stamp(target, lines([1, 2, 3]))
		run_event_tail.read_events(target)
		stamp_file.replace_text_stamp(target, lines([1]))
		expect_whole(target)
	})

	it('agrees with the whole read after the bound drops a middle line and the file grows', () => {
		const target = fresh_target()

		stamp_file.replace_text_stamp(target, lines([1, 2, 3]))
		run_event_tail.read_events(target)
		stamp_file.replace_text_stamp(target, lines([1, 3, 4, 5]))
		expect_whole(target)
	})

	it('agrees with the whole read after the file is replaced by another stream', () => {
		const target = fresh_target()

		stamp_file.replace_text_stamp(target, lines([1, 2]))
		run_event_tail.read_events(target)
		stamp_file.replace_text_stamp(target, lines([10, 11, 12]))
		expect_whole(target)
	})
})

describe('run_event_tail.read_events — edges', () => {
	it('reads an unterminated last line now and again once it completes', () => {
		const target = fresh_target()
		const partial = JSON.stringify(event(2))

		stamp_file.replace_text_stamp(target, `${lines([1])}${partial}`)
		expect_whole(target)
		stamp_file.replace_text_stamp(target, lines([1, 2, 3]))
		expect_whole(target)
	})

	it('reads an absent file as an empty stream, then the file once it appears', () => {
		const target = fresh_target()

		expect(run_event_tail.read_events(target)).toEqual([])
		stamp_file.replace_text_stamp(target, lines([1]))
		expect_whole(target)
	})
})
