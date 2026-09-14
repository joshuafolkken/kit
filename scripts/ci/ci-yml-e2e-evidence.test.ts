import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const {
	upload_input,
	upload_steps,
	ATTEMPT_SUFFIX,
	REPORT_ARTIFACT,
	LOG_ARTIFACT,
	UPLOAD_NAME_INPUT: NAME_INPUT,
} = ci_yml_fixture

const E2E_JOB = 'e2e'
// Both attempts of both artifacts. Listed rather than derived so the guard is checked against the
// job it was written for: a filter that silently matched nothing would otherwise let an empty loop
// report success. The runtime workflow publishes the report alone — it has no retry chain and no
// preview server, and the two files diverge in structure by design.
const TEMPLATE_ARTIFACTS = [REPORT_ARTIFACT, LOG_ARTIFACT].flatMap((artifact) => [
	artifact,
	`${artifact}${ATTEMPT_SUFFIX}`,
])
const WORKFLOWS = [
	{ path: ci_yml_fixture.TEMPLATE_CI_YML, artifacts: TEMPLATE_ARTIFACTS },
	{ path: ci_yml_fixture.RUNTIME_CI_YML, artifacts: [REPORT_ARTIFACT] },
]

// Scoped to the e2e job, where every upload exists to explain a run rather than to carry a
// deliverable: an upload whose artifact a later job consumes should fail the run when it fails, so
// a workflow-wide version of this rule would forbid something legitimate. No other job publishes
// an artifact today, and one that did would need its own reading of the rule, not this one.
//
// Both workflows, unlike the retry guards that assert on the template alone: those cover wiring
// kit's own file does not contain, while this step exists in both. Kit's e2e job is skipped while
// it ships no E2E specs, so the guard there is what keeps adding a spec from turning the gap live.
//
// The companion group in ci-yml-e2e-retry.test.ts derives its members from the after-failure
// condition and so also covers a future non-upload step added to that chain; this one follows the
// artifacts each job publishes and so also covers the uploads that run after the retry. Neither
// membership rule contains the other, which is why the two overlap on the -attempt-1 uploads.
describe.each(WORKFLOWS)('ci.yml e2e evidence uploads ($path)', ({ path, artifacts }) => {
	const uploads = upload_steps(ci_yml_fixture.find_job(path, E2E_JOB))

	// Regression guard for #809. `Upload test results` runs on always(), so it is the one evidence
	// step still executing after a retry that passed: a transient artifact-service error there
	// ended the job red on a run whose tests were green, skipping the auto-tag dispatch and
	// withholding the release exactly as the crash #783 was opened over. Asserted on the group so
	// an upload added later cannot omit the guard unnoticed.
	it('never lets publishing the e2e evidence decide the release', () => {
		expect(uploads.map((step) => upload_input(step, NAME_INPUT))).toEqual(
			expect.arrayContaining(artifacts),
		)

		for (const step of uploads) {
			expect(ci_yml_fixture.step_continue_on_error(step)).toBe(true)
		}
	})
})
