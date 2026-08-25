import { ci_yml_fixture, type WorkflowJob } from '#scripts/ci-yml-fixture'
import { describe, expect, it } from 'vitest'
import {
	CHECK_WAIT_INTERVAL_MS,
	DEFAULT_MAX_ATTEMPTS,
	DEFAULT_TIMEOUT_SECONDS,
} from './git-pr-checks'

// #851: the old 180-second default expired before any consumer whose CI includes E2E could finish,
// so the wait is derived from what the distributed workflows themselves permit rather than from a
// round number. Deriving it here keeps the two from drifting — raising a declared budget past this
// wait fails the suite instead of silently re-creating the timeout the default exists to prevent.
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
// Runner queueing happens before a job's own clock starts, so no declared cap covers it.
const QUEUE_HEADROOM_SECONDS = 300
// Every workflow this package distributes that produces a check the wait blocks on. The SonarQube
// workflow is included because its check is required by default (`git-pr-checks-eval.ts`), so its
// budget belongs in the derivation even though that job declares none today.
const SONAR_QUBE_YML = '.github/workflows/sonar-qube.yml'
// The template is what consumers receive; the runtime copy is what this repository's own `followup`
// waits on, and the two carry independent caps — deriving from one alone leaves the other free to
// outgrow the wait.
const WATCHED_WORKFLOWS: ReadonlyArray<string> = [
	ci_yml_fixture.TEMPLATE_CI_YML,
	ci_yml_fixture.RUNTIME_CI_YML,
	SONAR_QUBE_YML,
]

// A job cannot start before everything it needs has finished, so a run is as long as the longest
// chain through the `needs` graph — `e2e`'s 25 minutes behind `playwright-image`'s 2, not 25 alone.
// The in-progress set makes a malformed cyclic workflow return instead of recursing forever. A job
// that declares no `timeout-minutes` contributes 0: GitHub's implicit 6-hour limit is longer than
// any wait worth having, so an uncapped job is outside what this derivation can promise rather than
// something to inflate the budget for. The cap the number rests on is asserted separately.
function chain_minutes(
	jobs: Record<string, WorkflowJob>,
	name: string,
	in_progress: Set<string>,
): number {
	const job = jobs[name]

	if (job === undefined || in_progress.has(name)) return 0

	in_progress.add(name)

	const needs = ci_yml_fixture.job_needs(job)
	const upstream = needs.map((need) => chain_minutes(jobs, need, in_progress))

	in_progress.delete(name)

	return (ci_yml_fixture.job_timeout_minutes(job) ?? 0) + Math.max(0, ...upstream)
}

// Per workflow rather than over one merged map: `needs` resolves inside a workflow, so merging two
// would invent edges between jobs that happen to share a name.
function longest_chain_minutes(workflow_path: string): number {
	const { jobs } = ci_yml_fixture.load_workflow(workflow_path)

	return Math.max(0, ...Object.keys(jobs).map((name) => chain_minutes(jobs, name, new Set())))
}

describe('DEFAULT_TIMEOUT_SECONDS', () => {
	const longest_minutes = Math.max(...WATCHED_WORKFLOWS.map((path) => longest_chain_minutes(path)))

	it('reads a declared budget out of the distributed workflows', () => {
		expect(longest_minutes).toBeGreaterThan(0)
	})

	// Without this the guard fails open: deleting the cap it is derived from drops the chain to a
	// smaller number, both budget assertions keep passing, and the permitted run becomes 6 hours.
	it('still finds the cap the budget is derived from', () => {
		const e2e_minutes = ci_yml_fixture.job_timeout_minutes(ci_yml_fixture.e2e_template_job())

		expect(e2e_minutes).toBeGreaterThan(0)
		expect(longest_minutes).toBeGreaterThanOrEqual(e2e_minutes ?? 0)
	})

	it('outlasts the longest run the distributed CI permits, with queue headroom', () => {
		const chain_seconds = longest_minutes * SECONDS_PER_MINUTE

		expect(DEFAULT_TIMEOUT_SECONDS).toBeGreaterThanOrEqual(chain_seconds + QUEUE_HEADROOM_SECONDS)
	})

	// The loop sleeps between polls and not after the last one, so the wait it actually delivers is
	// one interval shorter than the attempt count suggests.
	it('waits out the whole budget', () => {
		const interval_seconds = CHECK_WAIT_INTERVAL_MS / MS_PER_SECOND
		const waited_seconds = (DEFAULT_MAX_ATTEMPTS - 1) * interval_seconds

		expect(waited_seconds).toBeGreaterThanOrEqual(DEFAULT_TIMEOUT_SECONDS)
	})
})
