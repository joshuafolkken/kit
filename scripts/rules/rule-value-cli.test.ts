import type { SessionFile } from '#scripts/cost/cost-transcript'
import { describe, expect, it } from 'vitest'
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
