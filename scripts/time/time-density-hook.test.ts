import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { time_density } from './time-density'
import { time_density_hook } from './time-density-hook'
import { time_transcript_fixture } from './time-transcript-fixture'

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'density-hook-'))
const ENOUGH_TURNS = time_transcript_fixture.DENSITY_TURNS
const ONE_CALL = 1
const THREE_CALLS = 3
const NOW_MS = 1_700_000_000_000
const RECENTLY_MS = 1000
const TAIL_SAMPLE_BYTES = 16
// Longer than the window above, so a read that ignored the window would return something else.
const LONG_TEXT = '0123456789'.repeat(3)
const ABSENT_PATH = path.join(WORK_DIRECTORY, 'no-such-session.jsonl')

// A transcript of its own per case, so one case's throttle record never silences another's — the
// record is keyed on the transcript the payload names. Each one is remembered rather than listed
// again in the teardown: the records land in the shared temp directory, not under `WORK_DIRECTORY`,
// so removing that directory does not take them with it.
const WRITTEN_TRANSCRIPTS = new Set<string>()

function write_transcript(name: string, text: string): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, text)
	WRITTEN_TRANSCRIPTS.add(target)

	return target
}

function payload(transcript_path: string): string {
	return JSON.stringify({ hook_event_name: 'PostToolUse', transcript_path })
}

// A payload naming a transcript of `calls`-per-turn turns, which is the whole input the reading has.
function payload_of(name: string, calls: number): string {
	return payload(write_transcript(name, time_transcript_fixture.density_text(ENOUGH_TURNS, calls)))
}

afterAll(() => {
	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(time_density_hook.notice_path(transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('time_density_hook.read_tail', () => {
	it('reads only the end of the file', () => {
		const target = write_transcript('tail', LONG_TEXT)
		const tail = time_density_hook.read_tail(target, TAIL_SAMPLE_BYTES)

		expect(tail).toBe(LONG_TEXT.slice(-TAIL_SAMPLE_BYTES))
	})

	it('reads a file shorter than the window whole', () => {
		const target = write_transcript('short', 'abc')

		expect(time_density_hook.read_tail(target, TAIL_SAMPLE_BYTES)).toBe('abc')
	})
})

describe('time_density_hook.density_notice', () => {
	it('returns the line for an unbatched run under the floor', () => {
		const notice = time_density_hook.density_notice(payload_of('unbatched', ONE_CALL), NOW_MS)

		expect(notice).toContain('calls per round trip')
	})

	it('returns nothing for a run that batches its calls', () => {
		const notice = time_density_hook.density_notice(payload_of('batched', THREE_CALLS), NOW_MS)

		expect(notice).toBeUndefined()
	})
})

// The line lands in the run's own context, so how often it may be said is part of the mechanism
// rather than a nicety (joshuafolkken/kit#1322).
describe('time_density_hook.density_notice — the throttle', () => {
	it('says nothing a second time until the interval has passed', () => {
		const raw = payload_of('throttled', ONE_CALL)

		expect(time_density_hook.density_notice(raw, NOW_MS)).toBeDefined()
		expect(time_density_hook.density_notice(raw, NOW_MS + RECENTLY_MS)).toBeUndefined()
	})

	it('says it again once the interval has passed', () => {
		const raw = payload_of('expired', ONE_CALL)
		const later = NOW_MS + time_density.NOTICE_INTERVAL_MS

		expect(time_density_hook.density_notice(raw, NOW_MS)).toBeDefined()
		expect(time_density_hook.density_notice(raw, later)).toBeDefined()
	})

	// The record is per session, so one run's line never silences the run that starts after it.
	it('leaves a different session its own budget', () => {
		const first = payload_of('session-a', ONE_CALL)
		const second = payload_of('session-b', ONE_CALL)

		expect(time_density_hook.density_notice(first, NOW_MS)).toBeDefined()
		expect(time_density_hook.density_notice(second, NOW_MS + RECENTLY_MS)).toBeDefined()
	})
})

// The hook runs after an edit has already landed, so every one of these has to end quietly rather
// than turn a successful write into a failed hook.
describe('time_density_hook.density_notice — nothing it reads may fail the edit', () => {
	it.each([
		['a transcript that is not there', () => payload(ABSENT_PATH)],
		['a payload that is not JSON', () => 'not json at all'],
		['a payload carrying no transcript path', () => JSON.stringify({ tool_name: 'Edit' })],
		['a transcript of unparseable lines', () => payload(write_transcript('junk', 'x\ny\nz'))],
		['an empty transcript', () => payload(write_transcript('empty', ''))],
	])('says nothing for %s', (_description, build) => {
		expect(() => time_density_hook.density_notice(build(), NOW_MS)).not.toThrow()
		expect(time_density_hook.density_notice(build(), NOW_MS)).toBeUndefined()
	})
})
