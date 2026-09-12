import { describe, expect, it } from 'vitest'
import { time_josh_commands } from './time-josh-commands'
import { time_report_fixture } from './time-report-fixture'
import { time_span_fixture } from './time-span-fixture'
import { time_spans, type Span } from './time-spans'

const { span, MINUTE_MS } = time_span_fixture
const { build } = time_report_fixture
const LINT = 'josh lint:related'
const TEST = 'josh test:related'

// A span running a chain of josh commands, its first on `josh_command` and the whole list on
// `josh_commands` — the shape `parse_timeline` builds for `pnpm josh A && pnpm josh B`.
function chained(minutes: number, commands: Array<string>): Span {
	return {
		...span(time_spans.TOOL_CATEGORY, minutes, 'Bash: pnpm', commands[0]),
		josh_commands: commands,
	}
}

describe('time_josh_commands.with_chained', () => {
	it('prices the chain on its first command and counts the rest with no duration', () => {
		const spans = time_josh_commands.with_chained([chained(4, [LINT, TEST])])

		expect(spans.map((one) => [one.josh_command, one.own_duration_ms])).toEqual([
			[LINT, 4 * MINUTE_MS],
			[TEST, 0],
		])
	})

	it('leaves a lone command unexpanded', () => {
		expect(time_josh_commands.with_chained([chained(2, ['josh gate'])])).toHaveLength(1)
	})

	it('leaves a span that ran no josh command untouched', () => {
		const plain = span(time_spans.TOOL_CATEGORY, 1, 'Read')

		expect(time_josh_commands.with_chained([plain])).toEqual([plain])
	})

	// A continuation is the tail of a call whose head already carries the chain, and the tables skip it
	// — expanding it would count the chain a second time.
	it('does not expand a continuation span', () => {
		const tail = { ...chained(4, [LINT, TEST]), is_continuation: true }

		expect(time_josh_commands.with_chained([tail])).toEqual([tail])
	})

	// The first command-bearing segment was not josh, so `josh_command` is empty and the chain's josh
	// command is recovered as an added call rather than lost.
	it('adds the josh command behind a non-josh opener', () => {
		const mixed = { ...span(time_spans.TOOL_CATEGORY, 3, 'Bash: git', ''), josh_commands: [TEST] }

		expect(time_josh_commands.with_chained([mixed]).map((one) => one.josh_command)).toEqual([
			'',
			TEST,
		])
	})
})

// The wiring: `build_report` feeds the expanded spans to both josh-keyed tables (joshuafolkken/kit#1883).
describe('time_report.build_report counts a chained call', () => {
	it('counts both commands of a chain, pricing the whole call on the first', () => {
		expect(build([chained(4, [LINT, TEST])]).by_josh_command).toEqual([
			{ label: LINT, duration_ms: 4 * MINUTE_MS, call_count: 1 },
			{ label: TEST, duration_ms: 0, call_count: 1 },
		])
	})

	it('counts the later command of a chain in the per-invocation table too', () => {
		const rows = build([chained(4, [LINT, TEST]), chained(4, [LINT, TEST])]).by_invocation

		expect(rows.map((row) => [row.label, row.call_count])).toEqual([
			[LINT, 2],
			[TEST, 2],
		])
	})
})
