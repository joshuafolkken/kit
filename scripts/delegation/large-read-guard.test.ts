import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
	large_read_outcome,
	large_read_refusal,
	large_reads,
	notice_refusal_path,
	refusal_path,
	SWITCH_ENV_KEY,
} from './large-read-guard'

// joshuafolkken/kit#7047: a whole-file Read of a large file is refused on the main line, a repeat of the
// refused file goes through until a read of it lands, and a lane child gets a notice instead.

const make_directory = temporary_directory('suite')
const WORK_DIRECTORY = make_directory('large-read-guard-')
const LANE_ISSUE = '7047'
const LANE_DIRECTORY = path.join(WORK_DIRECTORY, '.kit-lanes', LANE_ISSUE)
const WRITTEN_TRANSCRIPTS: Array<string> = []
const { ms, refused_turn_lines, target_turn_lines } = time_transcript_fixture
const context_of = hook_context_fixture.of
const LATER_TURN = 10
const EARLIER_MS = ms(5)
const NOW_MS = ms(59)
const UNSET = ''
const subject_counter = { value: 0 }

function subject_file(bytes: number): string {
	subject_counter.value += 1
	const target = path.join(WORK_DIRECTORY, `subject-${String(subject_counter.value)}.md`)

	writeFileSync(target, 'x'.repeat(bytes))

	return target
}

function large_file(): string {
	return subject_file(large_reads.LARGE_READ_BYTES + 1)
}

function lines_transcript(name: string, lines: ReadonlyArray<string>): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, lines.join('\n'))
	WRITTEN_TRANSCRIPTS.push(target)

	return target
}

function transcript_of(name: string): string {
	return lines_transcript(name, target_turn_lines(0, ['other.ts']))
}

function payload_of(transcript_path: string, file_path: string, overrides = {}): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path,
		tool_name: 'Read',
		tool_input: { file_path, ...overrides },
	})
}

// The guard's answer to a whole read of `file_path` over a transcript of `lines`.
function refusal_after(
	name: string,
	lines: ReadonlyArray<string>,
	file_path: string,
): string | undefined {
	const payload = payload_of(lines_transcript(name, lines), file_path)

	return large_read_refusal(payload, NOW_MS)
}

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = UNSET
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
})

afterAll(() => {
	for (const transcript of WRITTEN_TRANSCRIPTS) {
		rmSync(refusal_path(transcript), { force: true })
		rmSync(notice_refusal_path(transcript), { force: true })
	}
})

describe('large_read_refusal — which reads it refuses', () => {
	it('refuses a whole-file read of a file over the limit', () => {
		const payload = payload_of(transcript_of('large'), large_file())

		expect(large_read_refusal(payload, NOW_MS)).toBe(large_reads.REASON)
	})

	it('allows a whole-file read of a file at the limit', () => {
		const payload = payload_of(transcript_of('small'), subject_file(large_reads.LARGE_READ_BYTES))

		expect(large_read_refusal(payload, NOW_MS)).toBeUndefined()
	})

	it.each([{ offset: 100 }, { limit: 50 }])(
		'allows a sliced read of a large file (%o)',
		(slice) => {
			const payload = payload_of(transcript_of('sliced'), large_file(), slice)

			expect(large_read_refusal(payload, NOW_MS)).toBeUndefined()
		},
	)

	it('allows a read of a file that cannot be stat-ed', () => {
		const payload = payload_of(transcript_of('missing'), path.join(WORK_DIRECTORY, 'none.md'))

		expect(large_read_refusal(payload, NOW_MS)).toBeUndefined()
	})

	it('says nothing when the switch is off', () => {
		process.env[SWITCH_ENV_KEY] = 'off'
		const payload = payload_of(transcript_of('off'), large_file())

		expect(large_read_refusal(payload, NOW_MS)).toBeUndefined()
	})
})

describe('large_read_refusal — the repeat of a refused call goes through', () => {
	it('allows the same file once its latest read was refused, whatever was read in between', () => {
		const target = large_file()
		const lines = [...refused_turn_lines(0, [target]), ...target_turn_lines(1, ['other.ts'])]

		expect(refusal_after('repeat', lines, target)).toBeUndefined()
	})

	it('refuses another large file read right after a refusal', () => {
		const lines = refused_turn_lines(0, [large_file()])

		expect(refusal_after('other', lines, large_file())).toBe(large_reads.REASON)
	})

	it('refuses again once a read of the file has landed after the refusal', () => {
		const target = large_file()
		const lines = [...refused_turn_lines(0, [target]), ...target_turn_lines(1, [target])]

		expect(refusal_after('landed', lines, target)).toBe(large_reads.REASON)
	})
})

describe('large_read_outcome — a lane child is nudged, not killed', () => {
	it('raises a notice instead of a refusal', () => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		const lane = context_of(LANE_DIRECTORY, { [lane_child_marker.KEY]: LANE_ISSUE })
		const result = large_read_outcome(payload_of(transcript_of('lane'), large_file()), NOW_MS, lane)

		expect(result.reason).toBeUndefined()
		expect(result.notice).toBe(large_reads.NOTICE)
	})

	it('stays quiet on a second large read while no Read has landed since the notice', () => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		const lane = context_of(LANE_DIRECTORY, { [lane_child_marker.KEY]: LANE_ISSUE })
		const payload = payload_of(transcript_of('lane-quiet'), large_file())

		expect(large_read_outcome(payload, NOW_MS, lane).notice).toBe(large_reads.NOTICE)
		expect(large_read_outcome(payload, NOW_MS, lane).notice).toBeUndefined()
	})

	it('speaks again once a Read has landed after the notice', () => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		const lane = context_of(LANE_DIRECTORY, { [lane_child_marker.KEY]: LANE_ISSUE })
		const lines = [
			...target_turn_lines(0, ['other.ts']),
			...target_turn_lines(LATER_TURN, ['b.ts']),
		]
		const payload = payload_of(lines_transcript('lane-rearm', lines), large_file())

		expect(large_read_outcome(payload, EARLIER_MS, lane).notice).toBe(large_reads.NOTICE)
		expect(large_read_outcome(payload, EARLIER_MS, lane).notice).toBe(large_reads.NOTICE)
	})
})
