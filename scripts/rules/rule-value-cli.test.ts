import type { SessionFile } from '#scripts/cost/cost-transcript'
import { describe, expect, it } from 'vitest'
import type { RuleReading } from './rule-value'
import { rule_value_cli } from './rule-value-cli'

// The regression test for the defect that made the first published reading wrong
// (joshuafolkken/kit#1525). The measurement counted every transcript file as a run, and on a working
// checkout the delegated units outnumber the sessions several times over — so most of the
// denominator was subagent transcripts, and one run's evidence was split between the parent that
// kept a rule and the unit that reached its trigger. Without this test a revert to one run per file
// passes the whole suite green while the number it publishes is wrong.

function session_file(session_id: string, modified_ms: number): SessionFile {
	return {
		session_id,
		path: `/tmp/${session_id.replaceAll('/', '-')}.jsonl`,
		modified_ms,
		is_delegated: session_id.includes('/'),
	}
}

const PARENT = 'aaaa-1111'
const UNIT_ONE = `${PARENT}/agent-b1.jsonl`
const UNIT_TWO = `${PARENT}/agent-b2.jsonl`
const OTHER = 'cccc-2222'

describe('rule_value_cli.group_runs', () => {
	it('folds a run and its delegated units into one run', () => {
		const runs = rule_value_cli.group_runs([
			session_file(PARENT, 3),
			session_file(UNIT_ONE, 2),
			session_file(UNIT_TWO, 1),
		])

		expect(runs).toHaveLength(1)
		expect(runs[0]).toHaveLength(3)
	})

	it('keeps separate sessions apart', () => {
		const runs = rule_value_cli.group_runs([
			session_file(PARENT, 2),
			session_file(UNIT_ONE, 1),
			session_file(OTHER, 3),
		])

		expect(runs).toHaveLength(2)
	})

	it('does not depend on a unit following its parent in the listing', () => {
		// `list_sessions` returns newest first, so a unit can arrive before the session that owns it.
		const runs = rule_value_cli.group_runs([session_file(UNIT_ONE, 9), session_file(PARENT, 1)])

		expect(runs).toHaveLength(1)
	})

	it('counts nothing twice, so the denominator is the number of runs', () => {
		const files = [session_file(PARENT, 2), session_file(UNIT_ONE, 1), session_file(OTHER, 3)]
		const grouped = rule_value_cli.group_runs(files).flat()

		expect(grouped).toHaveLength(files.length)
	})
})

describe('rule_value_cli.has_own_transcript — a group orphaned by pruning is not a run', () => {
	it('rejects a group holding only delegated units', () => {
		// A project whose session files were pruned while their `subagents/` survived. Scored as a run,
		// its units go back into the denominator that joshuafolkken/kit#1525 took them out of.
		const orphaned = rule_value_cli.group_runs([
			session_file(UNIT_ONE, 2),
			session_file(UNIT_TWO, 1),
		])

		expect(orphaned).toHaveLength(1)
		expect(rule_value_cli.has_own_transcript(orphaned[0] ?? [])).toBe(false)
	})

	it('accepts a group whose session transcript survived', () => {
		const kept = rule_value_cli.group_runs([session_file(PARENT, 2), session_file(UNIT_ONE, 1)])

		expect(rule_value_cli.has_own_transcript(kept[0] ?? [])).toBe(true)
	})
})

function reading_of(is_measurable: boolean, sessions: number, unaided_kept: number): RuleReading {
	return { id: 'demo', sessions, unaided_kept, refusals: 0, is_measurable }
}

describe('rule_value_cli.rate_cell — an empty cell says which fact it is', () => {
	it('reports a rule that declares no compliance test as unmeasured', () => {
		expect(rule_value_cli.rate_cell(reading_of(false, 0, 0))).toBe(rule_value_cli.UNMEASURED)
	})

	it('reports a measurable rule no run reached as unreached, not as unmeasured', () => {
		// The two used to print the same `-`, and the documented reading of that cell is the first one
		// — so a rule the corpus simply never exercised read as one nothing can score.
		expect(rule_value_cli.rate_cell(reading_of(true, 0, 0))).toBe(rule_value_cli.UNREACHED)
	})

	it('keeps the two empty cells distinguishable from each other', () => {
		expect(rule_value_cli.UNREACHED).not.toBe(rule_value_cli.UNMEASURED)
	})

	it('reports a percentage where the rule was both measurable and reached', () => {
		expect(rule_value_cli.rate_cell(reading_of(true, 4, 1))).toBe('25%')
	})
})
