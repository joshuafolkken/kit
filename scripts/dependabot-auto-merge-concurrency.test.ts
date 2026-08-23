import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'

// #838 and #840 settled which of arming and withdrawing a single run performs. Neither ordered the
// runs against each other, and GitHub leaves them running in parallel unless a workflow declares a
// concurrency group — so a run that computed `has-kit-managed=false`, was overtaken by a force-push
// that added a kit-managed workflow, and reached its arming step after the newer run had already
// found nothing to withdraw, armed auto-merge on a diff kit overwrites. Nothing runs afterwards to
// undo it (joshuafolkken/kit#842).
//
// The group narrows that race without closing it, because cancellation is not instantaneous — so the
// arming command also names the head this run decided about, which GitHub checks as it arms. That
// half is template-only: kit's own copy has no withdrawal to be raced against, and its decision —
// the ecosystem and the semver level — is a fact about the bump that no push changes.
const {
	TEMPLATE,
	RUNTIME,
	CONCURRENCY_GROUP,
	MERGE_COMMAND,
	HEAD_MATCH_FLAG,
	HEAD_SHA_VARIABLE,
	HEAD_SHA_EXPRESSION,
	template_job,
	runtime_job,
	merge_step,
	step_run,
} = dependabot_workflow_fixture

const WORKFLOWS = [
	{ label: 'the distributed template', path: TEMPLATE },
	{ label: "kit's own workflow", path: RUNTIME },
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

describe('dependabot-auto-merge.yml stale-head guard', () => {
	// The expected head has to come from the event. Reading the branch inside the step and passing
	// that back would compare the current head with itself and hold on every run.
	it('names the head the run was triggered for', () => {
		expect(merge_step(template_job())?.env?.[HEAD_SHA_VARIABLE]).toBe(HEAD_SHA_EXPRESSION)
	})

	// On the arming command itself rather than in a read before it: GitHub applies the expectation as
	// it arms, so no push can land between the two.
	it('arms only when the branch still points at that head', () => {
		const arming = merge_step(template_job())

		expect(step_run(arming)).toContain(`${HEAD_MATCH_FLAG} "$${HEAD_SHA_VARIABLE}"`)
	})

	// kit's own copy has no withdrawal a stale run could arm behind, and no decision a push can
	// invalidate — so it takes the group and not the guard, the same way it takes no withdrawal.
	// Asserted against a step that is present, so a renamed step cannot satisfy this vacuously.
	it('is absent from kit’s own workflow, which has no withdrawal to be raced against', () => {
		const arming = merge_step(runtime_job())

		expect(arming).toBeDefined()
		expect(step_run(arming)).toContain(MERGE_COMMAND)
		expect(step_run(arming)).not.toContain(HEAD_MATCH_FLAG)
		expect(arming?.env?.[HEAD_SHA_VARIABLE]).toBeUndefined()
	})
})
