import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'

// #838 and #840 settled which of arming and withdrawing a single run performs. Neither ordered the
// runs against each other, and GitHub leaves them running in parallel unless a workflow declares a
// concurrency group — so a run that found nothing upstream-managed in the diff, was overtaken by a
// force-push that added one, and reached its arming step after the newer run had already
// found nothing to withdraw, armed auto-merge on a diff kit overwrites. Nothing runs afterwards to
// undo it (joshuafolkken/kit#842).
//
// The group narrows that race without closing it, because cancellation is not instantaneous — so the
// arming command also names the head this run decided about, which GitHub checks as it arms. kit's
// own copy takes it too: its decision reads the bump's metadata, which a commit pushed onto the
// Dependabot branch before the arming does not change, so without it that commit would be armed on a
// decision made for the bump alone (joshuafolkken/kit#4654).
const {
	TEMPLATE,
	RUNTIME,
	CONCURRENCY_GROUP,
	HEAD_MATCH_FLAG,
	HEAD_SHA_VARIABLE,
	HEAD_SHA_EXPRESSION,
	template_job,
	runtime_job,
	merge_step,
	step_run,
} = dependabot_workflow_fixture

const WORKFLOWS = [
	{ label: 'the distributed template', path: TEMPLATE, job: template_job },
	{ label: "kit's own workflow", path: RUNTIME, job: runtime_job },
]

describe('dependabot-auto-merge.yml concurrency', () => {
	// Both copies, because a group only one of them declares leaves the other running its runs in
	// parallel while every guard written against "the workflow" still passes.
	it.each(WORKFLOWS)('allows one run at a time per pull request in $label', ({ path }) => {
		expect(ci_yml_fixture.workflow_concurrency(path).group).toBe(CONCURRENCY_GROUP)
	})

	// Without this the group would queue the superseded run rather than stop it, and it would still
	// reach its arming step — later than before, and with the same stale decision.
	it.each(WORKFLOWS)('cancels a superseded run in $label rather than queueing it', ({ path }) => {
		expect(ci_yml_fixture.concurrency_cancels_in_progress(path)).toBe(true)
	})
})

describe.each(WORKFLOWS)('dependabot-auto-merge.yml stale-head guard in $label', ({ job }) => {
	// The expected head has to come from the event. Reading the branch inside the step and passing
	// that back would compare the current head with itself and hold on every run.
	it('names the head the run was triggered for', () => {
		expect(merge_step(job())?.env?.[HEAD_SHA_VARIABLE]).toBe(HEAD_SHA_EXPRESSION)
	})

	// On the arming command itself rather than in a read before it: GitHub applies the expectation as
	// it arms, so no push can land between the two.
	it('arms only when the branch still points at that head', () => {
		const arming = merge_step(job())

		expect(step_run(arming)).toContain(`${HEAD_MATCH_FLAG} "$${HEAD_SHA_VARIABLE}"`)
	})
})
