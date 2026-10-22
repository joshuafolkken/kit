import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

// joshuafolkken/kit#4541 merged with a `Node 22.19.0 build` still in progress: `node-compat` was
// neither a required check nor needed by `Checks`, so nothing waited for it (joshuafolkken/kit#4545).
//
// Executed rather than matched: the aggregate step's script runs under bash with the results GitHub
// would hand it, so the verdict pinned is the exit status `Checks` reports, not a substring. A
// timed-out matrix leg reports `failure` and a cancelled one `cancelled`; `skipped` and an empty value
// cover a matrix that never ran. Kept apart from `ci-yml-unit-job.test.ts` because a spawning test
// needs the isolated vitest project, and that file runs in the pure one.
const AGGREGATE_JOB = 'checks'
const FRESH_RUN = { REUSE_RESULT: 'false', STATIC_RESULT: 'success', UNIT_RESULT: 'success' }
const REUSED_RUN = { REUSE_RESULT: 'true', STATIC_RESULT: 'skipped', UNIT_RESULT: 'skipped' }
const UNFINISHED_NODE_RESULTS = ['failure', 'cancelled', 'skipped', '']

function aggregate_script(): string {
	const job = ci_yml_fixture.find_job(ci_yml_fixture.RUNTIME_CI_YML, AGGREGATE_JOB)

	return ci_yml_fixture.step_run(job?.steps?.[0])
}

function aggregate_exit_status(results: Readonly<Record<string, string>>): number {
	const run = spawnSync('bash', ['-c', aggregate_script()], {
		env: { PATH: process.env['PATH'], ...results },
		encoding: 'utf8',
	})

	return run.status ?? -1
}

describe('the Checks job fails unless the Node build matrix passed', () => {
	it.each([FRESH_RUN, REUSED_RUN])('passes when every result is green (%o)', (run) => {
		expect(aggregate_exit_status({ ...run, NODE_RESULT: 'success' })).toBe(0)
	})

	it.each(UNFINISHED_NODE_RESULTS)('fails a fresh run whose Node builds are %j', (node_result) => {
		expect(aggregate_exit_status({ ...FRESH_RUN, NODE_RESULT: node_result })).not.toBe(0)
	})

	it.each(UNFINISHED_NODE_RESULTS)('fails a reused run whose Node builds are %j', (node_result) => {
		expect(aggregate_exit_status({ ...REUSED_RUN, NODE_RESULT: node_result })).not.toBe(0)
	})
})
