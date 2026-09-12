import { describe, expect, it } from 'vitest'
import type { RunCostReader, RunCostReading } from './time-request-costs'
import { time_run, type RunSources } from './time-run'
import { time_run_fixture, type GhScript } from './time-run-fixture'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

// joshuafolkken/kit#1606, joshuafolkken/kit#1882: the run scopes read the cost corpus once and
// attribute it to the phases and to the delegated launches; the batch scopes do not, and say so
// rather than reporting a run that spent nothing.

const { CWD, ISSUE } = fixture
const { merged_pull, reader } = time_run_fixture

time_run_fixture.use_transcript_home()

const MERGED_SCRIPT: GhScript = { pull_body: merged_pull(2, 8) }
const ONE_DOLLAR = 1
const UNIT_TOKENS = 500_000
const UNIT_COST = 1.1

function cost_reader(asked: Array<string>, units: RunCostReading['units']): RunCostReader {
	return (cwd: string, issue_number: number) => {
		asked.push(`${cwd}#${String(issue_number)}`)

		return { priced: [{ at_ms: undefined, cost_usd: ONE_DOLLAR, is_priced: true }], units }
	}
}

function sources(asked: Array<string>, units: RunCostReading['units'] = []): RunSources {
	return { found: undefined, search: undefined, cost_of: cost_reader(asked, units) }
}

describe('time_run.build_run_report — the cost the phases and launches are attributed from', () => {
	it('reports both cost blocks unmeasured when no caller asked for them', async () => {
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT))

		expect([report.phase_costs?.is_measured, report.delegated_cost?.is_measured]).toEqual([
			false,
			false,
		])
	})

	it('prices the run when the caller supplies a reader', async () => {
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT), sources([]))

		expect([report.phase_costs?.is_measured, report.phase_costs?.cost_usd]).toEqual([true, 1])
	})

	it('carries the delegated launch costs through', async () => {
		const units = [
			{ session_id: 'agent-a', baseline_tokens: UNIT_TOKENS, cost_usd: UNIT_COST, is_priced: true },
		]
		const report = await time_run.build_run_report(
			ISSUE,
			CWD,
			reader(MERGED_SCRIPT),
			sources([], units),
		)

		expect([
			report.delegated_cost?.is_measured,
			report.delegated_cost?.unit_count,
			report.delegated_cost?.cost_usd,
		]).toEqual([true, 1, UNIT_COST])
	})

	it('asks the reader about the checkout and the issue it was called for', async () => {
		const asked: Array<string> = []

		await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT), sources(asked))

		expect(asked).toEqual([`${CWD}#${String(ISSUE)}`])
	})
})

describe('time_run.build_run_report — priced by contributor for the --json breakdown', () => {
	it('reports the contributor costs unmeasured when no caller asked for them', async () => {
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT))

		expect(report.contributor_costs?.is_measured).toBe(false)
	})

	it('carries the same run priced by contributor for the --json breakdown', async () => {
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT), sources([]))

		expect([report.contributor_costs?.is_measured, report.contributor_costs?.cost_usd]).toEqual([
			true,
			ONE_DOLLAR,
		])
	})
})
