import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { delegation_policy } from './delegation-policy'
import { investigation_reads } from './investigation-reads'

// joshuafolkken/kit#3139: a search carries no file text, so the file count never saw one — yet a run of
// `grep` turns re-reads the main line's whole context each time. What these cases pin is that search
// turns are counted from the transcript, a turn's parallel searches count once, and a delegation or a
// write starts the count over.

const { BRANCH, edit_call_line, error_result_line, ms, result_line, call_line, turn_call_line } =
	time_transcript_fixture

const THRESHOLD = delegation_policy.INVESTIGATION_SEARCH_TURN_THRESHOLD
const BELOW_THRESHOLD = THRESHOLD - 1
const TURN_MINUTES = 3
const LATE_START = 40
const NEVER_REFUSED_MS = 0
const SEARCH = 'grep -rn needle scripts'
const NEXT_SEARCH = { name: 'Bash', input: { command: 'rg haystack scripts' } }
const INSTRUCTION_SEARCH = { name: 'Bash', input: { command: 'grep -n rule prompts/review.md' } }
const GLOB_SEARCH = { name: 'Bash', input: { command: 'grep -n needle scripts/delegation/*.ts' } }
const MIXED_SEARCH = { name: 'Bash', input: { command: 'grep -rn needle CLAUDE.md scripts' } }
const WRITING_SEARCH = { name: 'Bash', input: { command: 'grep -rn needle scripts > hits.txt' } }

// One closed turn holding `calls` searches, all under one message id.
function search_turn(turn: number, calls = 1, start = 0): Array<string> {
	const minute = start + turn * TURN_MINUTES
	const ids = Array.from(
		{ length: calls },
		(_unused, index) => `search-${String(minute)}-${String(index)}`,
	)
	const input = { command: SEARCH }

	return [
		...ids.map((id) =>
			turn_call_line(minute, `message-${String(minute)}`, id, { name: 'Bash', input }),
		),
		...ids.map((id) => result_line(minute + 1, BRANCH, id)),
	]
}

function search_text(turns: number, start = 0): string {
	return Array.from({ length: turns }, (_unused, turn) => search_turn(turn, 1, start))
		.flat()
		.join('\n')
}

const AT_THRESHOLD_TEXT = search_text(BELOW_THRESHOLD)
const LATE_MINUTE = BELOW_THRESHOLD * TURN_MINUTES

describe('investigation_reads.tally_of — search turns', () => {
	it('counts every closed search turn', () => {
		expect(investigation_reads.tally_of(search_text(THRESHOLD)).searches).toBe(THRESHOLD)
	})

	it('counts a turn of parallel searches once', () => {
		expect(investigation_reads.tally_of(search_turn(0, THRESHOLD).join('\n')).searches).toBe(1)
	})

	it('does not count a search the harness refused', () => {
		const refused = [
			turn_call_line(0, 'message-0', 'denied', { name: 'Bash', input: { command: SEARCH } }),
			error_result_line(1, BRANCH, 'denied'),
		].join('\n')

		expect(investigation_reads.tally_of(refused).searches).toBe(0)
	})

	it('starts the count over at a delegation', () => {
		const text = [
			AT_THRESHOLD_TEXT,
			call_line(LATE_MINUTE, BRANCH, 'Agent', 'agent'),
			result_line(LATE_MINUTE + 1, BRANCH, 'agent'),
		].join('\n')

		expect(investigation_reads.tally_of(text).searches).toBe(0)
	})

	it('starts the count over at a successful write', () => {
		const text = [
			AT_THRESHOLD_TEXT,
			edit_call_line(LATE_MINUTE, BRANCH, 'scripts/one.ts', 'edit'),
			result_line(LATE_MINUTE + 1, BRANCH, 'edit'),
		].join('\n')

		expect(investigation_reads.tally_of(text).searches).toBe(0)
	})
})

// One closed turn holding the single search `call`.
function single_search_text(call: { name: string; input: unknown }): string {
	return [turn_call_line(0, 'message-0', 'single', call), result_line(1, BRANCH, 'single')].join(
		'\n',
	)
}

describe('investigation_reads.tally_of — search targets', () => {
	it('counts a search of the run’s own instructions', () => {
		expect(investigation_reads.tally_of(single_search_text(INSTRUCTION_SEARCH)).searches).toBe(1)
	})

	it('counts a search naming an instruction file beside a bare directory', () => {
		expect(investigation_reads.tally_of(single_search_text(MIXED_SEARCH)).searches).toBe(1)
	})

	it('counts a search whose target is a glob over subject files', () => {
		expect(investigation_reads.tally_of(single_search_text(GLOB_SEARCH)).searches).toBe(1)
	})

	it('does not count a search the guard could not refuse because it writes', () => {
		expect(investigation_reads.tally_of(single_search_text(WRITING_SEARCH)).searches).toBe(0)
	})
})

describe('investigation_reads.should_block — search turns', () => {
	it('refuses the search turn that reaches the threshold', () => {
		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, NEXT_SEARCH, NEVER_REFUSED_MS)).toBe(
			true,
		)
	})

	it('lets a search below the threshold through', () => {
		const text = search_text(BELOW_THRESHOLD - 1)

		expect(investigation_reads.should_block(text, NEXT_SEARCH, NEVER_REFUSED_MS)).toBe(false)
	})

	it('refuses a search naming an instruction file beside a bare directory', () => {
		expect(
			investigation_reads.should_block(AT_THRESHOLD_TEXT, MIXED_SEARCH, NEVER_REFUSED_MS),
		).toBe(true)
	})

	it('lets a search that writes through', () => {
		expect(
			investigation_reads.should_block(AT_THRESHOLD_TEXT, WRITING_SEARCH, NEVER_REFUSED_MS),
		).toBe(false)
	})

	it('refuses a glob search over subject files at the threshold', () => {
		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, GLOB_SEARCH, NEVER_REFUSED_MS)).toBe(
			true,
		)
	})

	it('does not refuse twice for one accumulation', () => {
		const refused_at = ms(LATE_MINUTE)

		expect(investigation_reads.should_block(AT_THRESHOLD_TEXT, NEXT_SEARCH, refused_at)).toBe(false)
	})

	it('refuses again once a further accumulation of searches follows the refusal', () => {
		const text = [AT_THRESHOLD_TEXT, search_text(BELOW_THRESHOLD, LATE_START)].join('\n')

		expect(investigation_reads.should_block(text, NEXT_SEARCH, ms(LATE_MINUTE))).toBe(true)
	})
})

describe('investigation_reads.REASON', () => {
	it('names the investigator agent the reading goes to', () => {
		expect(investigation_reads.REASON).toContain(`\`${investigation_reads.INVESTIGATOR_AGENT}\``)
	})

	it('names the search-turn threshold', () => {
		expect(investigation_reads.REASON).toContain(`${String(THRESHOLD)} search turns`)
	})
})
