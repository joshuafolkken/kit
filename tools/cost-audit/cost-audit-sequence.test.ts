import {
	time_transcript_line,
	type TranscriptLine,
} from '#scripts/time-runtime/time-transcript-line'
import { guard_friction_fixture } from '#tools/retrospective/guard-friction-fixture'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { cost_audit } from './cost-audit'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_sequence } from './cost-audit-sequence'

const { bash_call_line, refusal_line, allowed_line } = guard_friction_fixture
const { BRANCH } = time_transcript_fixture
const INVESTIGATION = '⛔ investigation: delegate the reading'
const GIT_STATUS = 'git status'
const GIT_DIFF = 'git diff'
const GATE = 'pnpm josh gate'

const STATUS_DIFF = 'git status → git diff'

function lined(lines: ReadonlyArray<string>): { lines: Array<TranscriptLine> } {
	return { lines: time_transcript_line.parse_text(lines.join('\n')) }
}

// Each command called and answered in turn, one minute apart.
function calls(commands: ReadonlyArray<string>, prefix: string): Array<string> {
	return commands.flatMap((command, index) => [
		bash_call_line(index, `${prefix}${String(index)}`, command),
		allowed_line(index, `${prefix}${String(index)}`),
	])
}

describe('cost_audit_sequence.sequences_of — Bash command runs', () => {
	const first = lined(calls([GIT_STATUS, GIT_DIFF, GATE], 'a'))
	const second = lined(calls([GIT_STATUS, GIT_DIFF], 'b'))
	const result = cost_audit_sequence.sequences_of([first, second])

	it('counts each run of two and three leading tokens, the most frequent first', () => {
		expect(result.runs).toEqual([
			{ key: STATUS_DIFF, count: 2 },
			{ key: 'git diff → josh gate', count: 1 },
			{ key: 'git status → git diff → josh gate', count: 1 },
		])
	})

	it('never joins the last call of one session to the first of the next', () => {
		expect(result.runs.map((row) => row.key)).not.toContain('josh gate → git status')
	})
})

describe('cost_audit_sequence.sequences_of — retries after a refusal', () => {
	it('counts a call of the refused token within the next two calls under its guard', () => {
		const session = lined([
			bash_call_line(1, 'a', 'cat x | head'),
			refusal_line(1, 'a', INVESTIGATION),
			bash_call_line(2, 'b', 'ls'),
			allowed_line(2, 'b'),
			bash_call_line(3, 'c', 'cat x'),
			allowed_line(3, 'c'),
		])

		expect(cost_audit_sequence.sequences_of([session]).retries).toEqual([
			{ key: 'investigation', count: 1 },
		])
	})
})

describe('cost_audit_sequence.sequences_of — the tokens a retry is matched on', () => {
	it('counts a retried josh call by its subcommand, never a refusal of another tool', () => {
		const session = lined([
			bash_call_line(1, 'a', 'pnpm josh gate | tail'),
			refusal_line(1, 'a', INVESTIGATION),
			bash_call_line(2, 'b', GATE),
			allowed_line(2, 'b'),
			time_transcript_fixture.tool_call_line(3, BRANCH, { name: 'Read', input: {}, id: 'r' }),
			refusal_line(3, 'r', INVESTIGATION),
			bash_call_line(4, 'c', ''),
			allowed_line(4, 'c'),
		])

		expect(cost_audit_sequence.sequences_of([session]).retries).toEqual([
			{ key: 'investigation', count: 1 },
		])
	})

	it('does not count a call past the reach or one issued beside the refused call', () => {
		const session = lined([
			bash_call_line(1, 'a', 'cat x'),
			bash_call_line(1, 'p', 'cat y'),
			refusal_line(1, 'a', INVESTIGATION),
			...calls(['ls', 'ls', 'cat x'], 'n'),
		])

		expect(cost_audit_sequence.sequences_of([session]).retries).toEqual([])
	})
})

describe('cost_audit_sequence.sequence_lines', () => {
	it('prints both sections, `none` where a section is empty', () => {
		const lines = cost_audit_sequence.sequence_lines({
			runs: [{ key: STATUS_DIFF, count: 2 }],
			retries: [],
		})

		expect(lines).toEqual([
			'',
			'Bash command runs (2 and 3 consecutive calls)',
			`  ${STATUS_DIFF}: 2`,
			'',
			'Retries after a refusal (same command within 2 calls), by guard',
			'  none',
		])
	})
})

describe('cost_audit.audit — the sequences read the current period alone', () => {
	const { ms, day, record, session } = cost_audit_fixture
	const current = day(1) + 1

	it('leaves out the calls of the period before', () => {
		const lines = [
			...calls([GIT_STATUS, GIT_DIFF], 'old'),
			bash_call_line(current, 'n1', GIT_STATUS),
			bash_call_line(current, 'n2', GATE),
		]
		const audited = { ...session('fullrun', [record('r', current, 1)]), ...lined(lines) }
		const result = cost_audit.audit({
			sessions: [audited],
			days: 1,
			now_ms: ms(day(2)),
			merges: undefined,
		})

		expect(result.sequences.runs).toEqual([{ key: 'git status → josh gate', count: 1 }])
	})
})
