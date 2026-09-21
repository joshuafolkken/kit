import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	deny_envelope,
	DISABLED_VALUES,
	duplicate_read_outcome,
	duplicate_read_refusal,
	duplicate_reads,
	is_enabled,
	notice_refusal_path,
	refusal_path,
	SWITCH_ENV_KEY,
} from './duplicate-read-guard'

// joshuafolkken/kit#2298: the hook half. What is pinned here is that an unchanged re-read is refused on
// the main line, that an edit (or any change that moves the mtime) lets the re-read through, that a
// failed stat allows the call, that the guard fires once per accumulation and re-arms on a later read,
// and that a dispatched lane child is nudged with a notice rather than killed with a refusal.

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'duplicate-read-guard-'))
// The directory vitest was launched from — a lane checkout carrying `JOSH_LANE_CHILD` — restored in
// teardown. The main-line cases delete the mark so the guard reads as `refuse`; the lane case chdirs
// into a lane checkout and sets it back, exactly as `investigation-guard.test.ts` does.
const ENTRY_DIRECTORY = process.cwd()
const LANE_ISSUE = '2298'
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', LANE_ISSUE)
const WRITTEN_TRANSCRIPTS: Array<string> = []
const { ms, target_turn_lines } = time_transcript_fixture

// The read span `target_turn_lines(0, …)` writes: the call on minute 1, its result on minute 2, so the
// span ends at `ms(2)`.
const FIRST_READ_MINUTE = 0
const LAST_READ_MS = ms(2)
// A second read of the same path, later in the run — the newer read that re-arms the guard.
const SECOND_READ_MINUTE = 10
const SECOND_READ_MS = ms(SECOND_READ_MINUTE * 2 + 2)
// A modification older than the read is unchanged content; one newer than it is a change.
const BEFORE_READ_MS = ms(1)
const AFTER_READ_MS = ms(3)
const NOW_MS = ms(59)
const EARLIER_REFUSAL_MS = ms(5)
// `utimesSync` takes seconds.
const MS_PER_SECOND = 1000
const READ_TOOL = 'Read'
const UNSET = ''

// A per-file counter kept on an object, so each call names a fresh path without a top-level variable
// assignment from inside the function.
const subject_counter = { value: 0 }

// A real file whose mtime the case controls, so the guard runs its normal stat path. Each case gets its
// own path, so one case's mtime never decides another's.
function subject_file(mtime_ms: number): string {
	subject_counter.value += 1
	const target = path.join(WORK_DIRECTORY, `subject-${String(subject_counter.value)}.ts`)

	writeFileSync(target, 'content')
	utimesSync(target, mtime_ms / MS_PER_SECOND, mtime_ms / MS_PER_SECOND)

	return target
}

function write_transcript(name: string, lines: ReadonlyArray<string>): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, lines.join('\n'))
	WRITTEN_TRANSCRIPTS.push(target)

	return target
}

// A run that read `target` once, at `ms(2)`.
function read_once(name: string, target: string): string {
	return write_transcript(name, target_turn_lines(FIRST_READ_MINUTE, [target]))
}

function payload_of(transcript_path: string, file_path: string, overrides = {}): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path,
		tool_name: READ_TOOL,
		tool_input: { file_path, ...overrides },
	})
}

// The mark is deleted so the ambient `JOSH_LANE_CHILD` of the lane checkout these tests run in cannot
// turn the guard to `notice` and green the main-line cases on a guard that never refused; the lane case
// sets it back for itself.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = UNSET
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
})

afterAll(() => {
	process.chdir(ENTRY_DIRECTORY)

	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(refusal_path(transcript), { force: true })
		rmSync(notice_refusal_path(transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { force: true, recursive: true })
})

describe('duplicate_read_refusal — the unchanged re-read', () => {
	it('refuses a second read of a path whose content has not changed', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = read_once('unchanged', target)
		const refusal = duplicate_read_refusal(payload_of(transcript, target), NOW_MS)

		expect(refusal).toBe(duplicate_reads.REASON)
	})

	it('allows a re-read of a file that changed after it was last read', () => {
		const target = subject_file(AFTER_READ_MS)
		const transcript = read_once('changed', target)

		expect(duplicate_read_refusal(payload_of(transcript, target), NOW_MS)).toBeUndefined()
	})

	it('allows the first read, with no earlier read of the path in the run', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = write_transcript(
			'first-read',
			target_turn_lines(FIRST_READ_MINUTE, ['other.ts']),
		)

		expect(duplicate_read_refusal(payload_of(transcript, target), NOW_MS)).toBeUndefined()
	})

	it('allows a paginated re-read, which reads a different region', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = read_once('paginated', target)
		const paginated = payload_of(transcript, target, { offset: 100, limit: 50 })

		expect(duplicate_read_refusal(paginated, NOW_MS)).toBeUndefined()
	})
})

describe('duplicate_read_refusal — every failure allows the call', () => {
	it('allows the read when the file cannot be stat-ed', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = read_once('stat-fail', target)

		rmSync(target, { force: true })

		expect(duplicate_read_refusal(payload_of(transcript, target), NOW_MS)).toBeUndefined()
	})

	it('says nothing for a call that is not a Read', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = read_once('not-read', target)
		const bash = JSON.stringify({
			transcript_path: transcript,
			tool_name: 'Bash',
			tool_input: { command: 'cat scripts/x.ts' },
		})

		expect(duplicate_read_refusal(bash, NOW_MS)).toBeUndefined()
	})

	it('says nothing when the payload is not JSON', () => {
		expect(duplicate_read_refusal('not json', NOW_MS)).toBeUndefined()
	})

	it('says nothing when the switch is off', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = read_once('switched-off', target)

		process.env[SWITCH_ENV_KEY] = DISABLED_VALUES[0] ?? 'off'

		expect(duplicate_read_refusal(payload_of(transcript, target), NOW_MS)).toBeUndefined()
	})
})

describe('duplicate_read_refusal — one refusal per accumulation', () => {
	// Without this the same unchanged read is refused on every look and the run is wedged on a file it
	// insists on re-reading.
	it('refuses the same unchanged read only once', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = read_once('once', target)

		expect(duplicate_read_refusal(payload_of(transcript, target), NOW_MS)).toBeDefined()
		expect(duplicate_read_refusal(payload_of(transcript, target), NOW_MS)).toBeUndefined()
	})

	// A fresh successful read of the target after the refusal is a new redundant episode, so the guard
	// speaks again — the re-accumulation half of "one refusal per accumulation".
	it('refuses again once a newer read of the path has landed', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = write_transcript('rearmed', [
			...target_turn_lines(FIRST_READ_MINUTE, [target]),
			...target_turn_lines(SECOND_READ_MINUTE, [target]),
		])

		expect(SECOND_READ_MS).toBeGreaterThan(EARLIER_REFUSAL_MS)
		expect(LAST_READ_MS).toBeLessThan(SECOND_READ_MS)
		expect(duplicate_read_refusal(payload_of(transcript, target), EARLIER_REFUSAL_MS)).toBeDefined()
		expect(duplicate_read_refusal(payload_of(transcript, target), NOW_MS)).toBeDefined()
	})
})

describe('duplicate_read_outcome — a dispatched lane child is nudged, not killed', () => {
	// joshuafolkken/kit#2298: a refusal ends a headless child's turn (kit#2138), and the duplicates are
	// measured in those children — so there the guard is `notice`, not `off`: the call proceeds and the
	// guidance rides along without a `permissionDecision`.
	beforeEach(() => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)
		process.env[lane_child_marker.KEY] = LANE_ISSUE
	})

	afterEach(() => {
		process.chdir(ENTRY_DIRECTORY)
	})

	it('raises a notice instead of a refusal for an unchanged re-read', () => {
		const target = subject_file(BEFORE_READ_MS)
		const transcript = read_once('lane-notice', target)
		const result = duplicate_read_outcome(payload_of(transcript, target), NOW_MS)

		expect(result.reason).toBeUndefined()
		expect(result.notice).toBe(duplicate_reads.NOTICE)
	})
})

describe('the guard is adopted without configuring anything', () => {
	it('is on when the variable is unset', () => {
		process.env[SWITCH_ENV_KEY] = UNSET

		expect(is_enabled()).toBe(true)
	})

	it('names a switch of its own, so it is not the investigation guard', () => {
		expect(SWITCH_ENV_KEY).toBe('JOSH_DUPLICATE_READ_GUARD')
	})

	it('answers in the shape that stops a call', () => {
		expect(JSON.parse(deny_envelope(duplicate_reads.REASON))).toMatchObject({
			hookSpecificOutput: { permissionDecision: 'deny' },
		})
	})
})
