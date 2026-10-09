import { session_cite } from '#scripts/issue/session-cite'
import { describe, expect, it } from 'vitest'
import { run_tidy, type LaneFacts } from './run-tidy'

const MERGED_LANE: LaneFacts = {
	issue: '2583',
	is_merged: true,
	has_changes: false,
	has_unpushed: false,
	is_running: false,
}
const CHANGES_REASON = 'uncommitted changes'
const LANE_TARGET = 'lane #2583'
const LEDGER_LINE = '- k:lane-seat | d1 | 2026-09-29 | lane | a merged lane held a seat'
const OTHER_LEDGER_LINE = '- k:stash-pile | d1 | 2026-09-29 | stash | stashes outlived their issue'

// joshuafolkken/kit#2701: every rule keeps the thing on doubt.
describe('run_tidy.lane_verdict', () => {
	it('closes a merged lane with a clean, pushed tree and no live run', () => {
		expect(run_tidy.lane_verdict(MERGED_LANE)).toStrictEqual(run_tidy.CLEAN)
	})

	it('leaves a lane whose issue is not merged out of the report', () => {
		expect(run_tidy.lane_verdict({ ...MERGED_LANE, is_merged: false })).toBeUndefined()
	})

	it.each([
		['has_changes', CHANGES_REASON],
		['has_unpushed', 'commits no remote has'],
		['is_running', 'held by a live run'],
	] as const)('keeps a merged lane when %s', (field, reason) => {
		expect(run_tidy.lane_verdict({ ...MERGED_LANE, [field]: true })).toStrictEqual(
			run_tidy.keep(reason),
		)
	})
})

describe('run_tidy.stash_verdict', () => {
	const merged = new Set(['2583', '2584'])

	it('drops an entry whose issues are all merged', () => {
		expect(run_tidy.stash_verdict({ subject: '', issues: ['2583', '2584'] }, merged)).toStrictEqual(
			run_tidy.CLEAN,
		)
	})

	it('keeps an entry naming an issue that is not merged, and says which', () => {
		expect(run_tidy.stash_verdict({ subject: '', issues: ['2583', '2701'] }, merged)).toStrictEqual(
			run_tidy.keep(`${session_cite.issue(2701)} not merged`),
		)
	})

	it.each([
		['names no issue', []],
		['names only issues that are not merged', ['2701']],
	])('leaves an entry that %s out of the report', (_label, issues) => {
		expect(run_tidy.stash_verdict({ subject: '', issues }, merged)).toBeUndefined()
	})
})

describe('run_tidy.ledger_carry', () => {
	it('carries ledger lines the ledger does not hold yet, once each', () => {
		const added = [LEDGER_LINE, LEDGER_LINE, OTHER_LEDGER_LINE, 'not a ledger line']

		expect(run_tidy.ledger_carry(added, `# Observations\n${OTHER_LEDGER_LINE}\n`)).toStrictEqual([
			LEDGER_LINE,
		])
	})

	it('carries nothing when every line is already there', () => {
		expect(run_tidy.ledger_carry([LEDGER_LINE], `${LEDGER_LINE}\n`)).toStrictEqual([])
	})
})

describe('run_tidy.format_report', () => {
	it('prints nothing when nothing merged was found', () => {
		expect(run_tidy.format_report([])).toBeUndefined()
	})

	it('lists what was cleaned and what was kept, with the reason', () => {
		const report = run_tidy.format_report([
			{ target: LANE_TARGET, verdict: run_tidy.CLEAN },
			{ target: 'lane #2584', verdict: run_tidy.keep(CHANGES_REASON) },
		])

		expect(report).toBe(
			[
				'run:tidy — cleaned:',
				`  ${LANE_TARGET}`,
				'run:tidy — kept:',
				'  lane #2584 — uncommitted changes',
			].join('\n'),
		)
	})
})
