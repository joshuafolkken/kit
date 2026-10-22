import { run_prep } from '#scripts/run/run-prep'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { delegation_policy } from './delegation-policy'
import { investigation_reads } from './investigation-reads'

// joshuafolkken/kit#4345: the entry names the delegation step before the first read, so a run that
// follows it sends the reading to a unit up front and is never refused mid-reading. The guard's
// threshold and its decision are untouched; what is pinned is that the step the entry names is the
// step the refusal names, and that a run taking it does not reach the refusal.

const { BRANCH, call_line, edit_call_line, ms, result_line, target_turn_lines } =
	time_transcript_fixture

const THRESHOLD = delegation_policy.INVESTIGATION_FILE_THRESHOLD
const DELEGATION_MINUTE = 2
const DELEGATION_END_MINUTE = 4
const EDIT_MINUTE = 40
const EDIT_TURN = 30
const NEVER_REFUSED_MS = 0
const AGENT_ID = 'investigator-call'
const SUBJECT_FILES = Array.from(
	{ length: THRESHOLD },
	(_unused, index) => `scripts/subject-${String(index)}.ts`,
)
const EDIT_TARGETS = SUBJECT_FILES.slice(0, THRESHOLD - 1)
const NEXT_READ = { name: 'Read', input: { file_path: 'scripts/edit-next.ts' } }

const ENTRY_REPORT = run_prep.format_report({
	issue_number: '4345',
	content_body: '',
	state: undefined,
	state_failure: '',
	latest_scope: 'skip',
	latest_reason: '',
	locations: '',
	has_changes: false,
	ship_problems: [],
})

function delegation_lines(): Array<string> {
	return [
		call_line(DELEGATION_MINUTE, BRANCH, 'Agent', AGENT_ID),
		result_line(DELEGATION_END_MINUTE, BRANCH, AGENT_ID),
	]
}

// The main line after the unit returns: it opens only the files it edits, and edits each.
function edit_lines(): Array<string> {
	return [
		...target_turn_lines(EDIT_TURN, EDIT_TARGETS),
		...EDIT_TARGETS.flatMap((file, index) => [
			edit_call_line(EDIT_MINUTE + index, BRANCH, file, `edit-${String(index)}`),
			result_line(EDIT_MINUTE + index, BRANCH, `edit-${String(index)}`),
		]),
	]
}

describe('run_prep.format_report — the investigation step at the entry', () => {
	it('names the step the guard would otherwise name only on its refusal', () => {
		expect(ENTRY_REPORT).toContain(
			`${run_prep.INVESTIGATION_HEADER}\nDelegate before the first read`,
		)
		expect(ENTRY_REPORT).toContain(delegation_policy.INVESTIGATION_STEP)
		expect(investigation_reads.REASON).toContain(delegation_policy.INVESTIGATION_STEP)
	})

	it('states the same limit the guard refuses at', () => {
		expect(ENTRY_REPORT).toContain(delegation_policy.INVESTIGATION_LIMIT)
		expect(investigation_reads.REASON).toContain(delegation_policy.INVESTIGATION_LIMIT)
	})
})

describe('investigation_reads.should_block — a run that takes the entry step', () => {
	it('is refused mid-reading when it reads the subject in the main line first', () => {
		const text = target_turn_lines(0, EDIT_TARGETS).join('\n')

		expect(investigation_reads.should_block(text, NEXT_READ, NEVER_REFUSED_MS)).toBe(true)
	})

	it('is not refused when it delegates before the first read and reads only what it edits', () => {
		const text = [...delegation_lines(), ...edit_lines()].join('\n')

		expect(investigation_reads.tally_of(text).reset_ms).toBe(ms(DELEGATION_END_MINUTE))
		expect(investigation_reads.should_block(text, NEXT_READ, NEVER_REFUSED_MS)).toBe(false)
	})
})
