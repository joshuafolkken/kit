import { describe, expect, it } from 'vitest'
import type { PricedRequest } from './time-phase-costs'
import { time_run, type RunSources } from './time-run'
import { time_run_fixture, type GhScript } from './time-run-fixture'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

// joshuafolkken/kit#1606: the run scopes read what the run cost and attribute it to the phases; the
// batch scopes do not, and say so rather than reporting a run that spent nothing.

const { CWD, ISSUE } = fixture
const { merged_pull, reader } = time_run_fixture

time_run_fixture.use_transcript_home()

const MERGED_SCRIPT: GhScript = { pull_body: merged_pull(2, 8) }
const ONE_DOLLAR = 1

type Reader = (cwd: string, issue_number: number) => Array<PricedRequest>

function priced_reader(asked: Array<string>): Reader {
	return (cwd: string, issue_number: number) => {
		asked.push(`${cwd}#${String(issue_number)}`)

		return [{ at_ms: undefined, cost_usd: ONE_DOLLAR, is_priced: true }]
	}
}

function sources(asked: Array<string>): RunSources {
	return { found: undefined, search: undefined, priced_of: priced_reader(asked) }
}

describe('time_run.build_run_report — the cost the phases are attributed from', () => {
	it('reports the phase costs unmeasured when no caller asked for them', async () => {
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT))

		expect(report.phase_costs?.is_measured).toBe(false)
	})

	it('prices the run when the caller supplies a reader', async () => {
		const report = await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT), sources([]))

		expect([report.phase_costs?.is_measured, report.phase_costs?.cost_usd]).toEqual([true, 1])
	})

	it('asks the reader about the checkout and the issue it was called for', async () => {
		const asked: Array<string> = []

		await time_run.build_run_report(ISSUE, CWD, reader(MERGED_SCRIPT), sources(asked))

		expect(asked).toEqual([`${CWD}#${String(ISSUE)}`])
	})
})
