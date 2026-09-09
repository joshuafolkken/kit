import { describe, expect, it } from 'vitest'
import { time_instructions, type InstructionsInput } from './time-instructions'
import { time_span_fixture } from './time-span-fixture'
import type { Span } from './time-spans'

// The cases use this repository's own documents rather than temporary files, because the subject is
// which paths count as instructions — a rule anchored at the repository root, which a file written
// into a temporary directory could not exercise.
const RULE_DOCUMENT = 'CLAUDE.md'
const SUBJECT_FILE = 'scripts/time/time-cli.ts'

const RESIDENT_TOKENS = 1000
const BILLED_TOKENS = 10_000
const REQUEST_COUNT = 5
const MODEL_WAIT_MS = 200_000
const CARRIED_TOKENS = 5000
const HALF_SHARE = 0.5
const ATTRIBUTED_MS = 100_000
const TINY_BILLED_TOKENS = 100
const NO_TOKENS = 0
const ONE_FILE = 1

function read_span(targets: ReadonlyArray<string>): Span {
	return { ...time_span_fixture.span('tool', 0, 'Read'), targets }
}

// Four assistant turns at fixed instants, with the read falling between the first and the second:
// three of the four followed it, which over five requests rounds to four.
const TURN_INSTANTS = [10, 30, 40, 50]
const SECOND_TURN_MS = 20
const TURNS_AFTER_READ = 4

function turn_span(index: number, ended_ms: number): Span {
	return { ...time_span_fixture.span('model', 0), message_id: `turn-${String(index)}`, ended_ms }
}

const TURNS = TURN_INSTANTS.map((ended_ms, index) => turn_span(index, ended_ms))

function input_of(
	spans: ReadonlyArray<Span>,
	billed_input_tokens: number = BILLED_TOKENS,
): InstructionsInput {
	return {
		spans,
		resident_tokens: RESIDENT_TOKENS,
		billed_input_tokens,
		request_count: REQUEST_COUNT,
		model_wait_ms: MODEL_WAIT_MS,
	}
}

describe('time_instructions.read_paths', () => {
	it('keeps an instruction document and drops a subject file', () => {
		const paths = time_instructions.read_paths([read_span([RULE_DOCUMENT, SUBJECT_FILE])])

		expect(paths).toHaveLength(ONE_FILE)
		expect(paths[0]).toContain(RULE_DOCUMENT)
	})

	it('counts a document the run opened twice only once', () => {
		const spans = [read_span([RULE_DOCUMENT]), read_span([RULE_DOCUMENT])]

		expect(time_instructions.read_paths(spans)).toHaveLength(ONE_FILE)
	})

	it('ignores a call that wrote rather than read', () => {
		const span = { ...time_span_fixture.span('tool', 0, 'Write'), targets: [RULE_DOCUMENT] }

		expect(time_instructions.read_paths([span])).toHaveLength(NO_TOKENS)
	})
})

describe('time_instructions.build', () => {
	it('charges the resident preamble to every request', () => {
		const load = time_instructions.build(input_of([]))

		expect(load.read_tokens).toBe(NO_TOKENS)
		expect(load.carried_input_tokens).toBe(CARRIED_TOKENS)
		expect(load.token_share).toBe(HALF_SHARE)
		expect(load.attributed_ms).toBe(ATTRIBUTED_MS)
	})

	it('sizes an instruction document the run read, from disk', () => {
		const load = time_instructions.build(input_of([read_span([RULE_DOCUMENT])]))

		expect(load.files).toHaveLength(ONE_FILE)
		expect(load.files[0]?.path).toBe(RULE_DOCUMENT)
		expect(load.read_tokens).toBeGreaterThan(NO_TOKENS)
	})

	// The fallback, for a transcript written before message ids were recorded: no turn to count, so
	// the document is charged to every request after the first.
	it('charges a read document to every request after the first when no turn can be counted', () => {
		const load = time_instructions.build(input_of([read_span([RULE_DOCUMENT])]))
		const documents = load.carried_input_tokens - CARRIED_TOKENS

		expect(load.files[0]?.requests_after).toBe(REQUEST_COUNT - ONE_FILE)
		expect(documents).toBe(load.read_tokens * (REQUEST_COUNT - ONE_FILE))
	})

	// **The measured path, which is what keeps the ceiling usable.** Charging every document to the
	// whole run put one real session's instruction text at 80.7% of its billed input; counting the
	// turns that actually followed the read is what makes the number decidable.
	it('charges a read document only to the turns that followed it', () => {
		const read = { ...read_span([RULE_DOCUMENT]), ended_ms: SECOND_TURN_MS }
		const load = time_instructions.build(input_of([...TURNS, read]))

		expect(load.files[0]?.requests_after).toBe(TURNS_AFTER_READ)
	})
})

describe('time_instructions.build — what it will not report', () => {
	// A compacted session bills later requests below the first request's baseline, which the resident
	// figure is fixed at, so the carried total can exceed the billed one. An upper bound larger than
	// the total it bounds is not a bound.
	it('never attributes more than the whole of the model wait', () => {
		const load = time_instructions.build(input_of([], TINY_BILLED_TOKENS))

		expect(load.carried_input_tokens).toBeGreaterThan(load.billed_input_tokens)
		expect(load.charged_input_tokens).toBe(TINY_BILLED_TOKENS)
		expect(load.token_share).toBe(1)
		expect(load.attributed_ms).toBe(MODEL_WAIT_MS)
	})

	it('reports no share when the transcript recorded no billed input', () => {
		const load = time_instructions.build(input_of([], NO_TOKENS))

		expect(load.token_share).toBe(NO_TOKENS)
		expect(load.attributed_ms).toBe(NO_TOKENS)
	})
})

describe('time_instructions.format_instructions', () => {
	it('names the heading, the document and the attributed share', () => {
		const load = time_instructions.build(input_of([read_span([RULE_DOCUMENT])]))
		const text = time_instructions.format_instructions(load)

		expect(text).toContain(time_instructions.HEADING)
		expect(text).toContain(RULE_DOCUMENT)
		expect(text).toContain(time_instructions.SESSION_SCOPE)
	})

	it('says so rather than printing a share when nothing was billed', () => {
		const text = time_instructions.format_instructions(
			time_instructions.build(input_of([], NO_TOKENS)),
		)

		expect(text).toContain(time_instructions.NO_BILLING)
		expect(text).not.toContain(time_instructions.SESSION_SCOPE)
	})
})
