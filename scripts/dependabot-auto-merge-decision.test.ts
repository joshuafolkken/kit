import { describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture, type WorkflowRun } from './dependabot-workflow-fixture'
import { workflow_expression_fixture } from './workflow-expression-fixture'

// Which updates may arm auto-merge, asserted by evaluating the workflow's own decision with GitHub's
// expression engine. A substring match proves a clause was written; only an evaluation proves that a
// given update cannot reach the arming call (joshuafolkken/kit#802).
//
// Four rounds of fixes each added an axis to this decision, and each had to add it to several
// conditions that were required to stay exact complements of one another. joshuafolkken/kit#845
// collapsed them into this one expression, so the reproduction path each round closed is now a row
// in one table rather than a property of a gate that no longer exists.
const {
	DEPENDABOT_LOGIN,
	MAINTAINER_LOGIN,
	ACTIONS_ECOSYSTEM,
	NPM_ECOSYSTEM,
	PATCH_UPDATE,
	MINOR_UPDATE,
	MAJOR_UPDATE,
	NO_OUTPUT,
	MANAGED,
	NOT_MANAGED,
	build_run_context,
	decision_expression,
	entitlement_expression,
	template_job,
} = dependabot_workflow_fixture

function is_armed(run: WorkflowRun): boolean {
	return workflow_expression_fixture.evaluate_condition(
		decision_expression(template_job()),
		build_run_context(run),
	)
}

// Whether the *run* is entitled to decide, as opposed to whether the *bump* qualifies. The
// withdrawal keys on this narrower question.
function may_arm(run: WorkflowRun): boolean {
	return workflow_expression_fixture.evaluate_condition(
		entitlement_expression(template_job()),
		build_run_context(run),
	)
}

// Every value either expression mentions, whatever field it mentions it in, plus the values a real
// run produces that no expression names. Derived from the expressions rather than listed, because a
// list only sweeps the values whoever wrote it thought of: a clause added for some new actor would
// introduce a value the sweep below never tries, and the invariant would pass without covering the
// very clause that broke it.
function swept_values(): ReadonlyArray<string> {
	const declared = `${decision_expression(template_job())} ${entitlement_expression(template_job())}`
	const literals = Array.from(declared.matchAll(/'([^']*)'/gu), ([, value]) => value ?? '')

	return [...new Set([...literals, MAINTAINER_LOGIN, MANAGED, MAJOR_UPDATE, NO_OUTPUT])]
}

// One more input taken at every swept value, for every combination built so far.
function widen(
	combinations: ReadonlyArray<ReadonlyArray<string>>,
	values: ReadonlyArray<string>,
): Array<Array<string>> {
	return combinations.flatMap((combination) => values.map((value) => [...combination, value]))
}

// Every combination of those values across the four inputs the expressions read. Built by widening
// one input at a time rather than by nesting a callback per input, which is the same product.
// The inputs `build_run_context` supplies, spelled as the expressions address them. The sweep varies
// exactly these, so the decision may read exactly these.
const MODELLED_PATHS: ReadonlyArray<string> = [
	'github.actor',
	'steps.managed.outputs.has-upstream-managed',
	'steps.metadata.outputs.package-ecosystem',
	'steps.metadata.outputs.update-type',
]

// Derived rather than written, so a path added above is swept rather than pinned at one value by a
// count that stayed behind.
const INPUT_COUNT = MODELLED_PATHS.length

function every_run(): ReadonlyArray<WorkflowRun> {
	const values = swept_values()
	let combinations: ReadonlyArray<ReadonlyArray<string>> = [[]]

	for (let taken = 0; taken < INPUT_COUNT; taken += 1) combinations = widen(combinations, values)

	return combinations.map(
		([actor = '', managed_output = '', ecosystem = '', update_type = '']) => ({
			actor,
			managed_output,
			ecosystem,
			update_type,
		}),
	)
}

// Every context GitHub exposes to an expression, so a clause on any of them is reported rather than
// slipping past a shorter list — the point is to notice a path the sweep does not model, and which
// context it came from is not the interesting part.
const CONTEXT_REFERENCE =
	/\b(?:env|github|inputs|job|jobs|matrix|needs|runner|secrets|steps|strategy|vars)(?:\.[\w-]+)+/gu

// Every context path either expression reads, in the spelling the expression uses.
function referenced_paths(): ReadonlyArray<string> {
	const declared = `${decision_expression(template_job())} ${entitlement_expression(template_job())}`
	const references = Array.from(declared.matchAll(CONTEXT_REFERENCE), ([reference]) => reference)

	return [...new Set(references)].toSorted((left, right) => left.localeCompare(right))
}

// Every swept run the decision arms while the entitlement denies it. Both expressions are read once
// rather than per row: reading them re-parses the workflow, and this walks the whole product.
function runs_armed_without_entitlement(): ReadonlyArray<WorkflowRun> {
	const decision = decision_expression(template_job())
	const entitlement = entitlement_expression(template_job())

	return every_run().filter((run) => {
		const context = build_run_context(run)
		const { evaluate_condition } = workflow_expression_fixture

		return evaluate_condition(decision, context) && !evaluate_condition(entitlement, context)
	})
}

// A bump Dependabot opened against a workflow the consumer owns: the ordinary case, and the one the
// distribution exists for.
function consumer_owned_bump(update_type: string): WorkflowRun {
	return {
		actor: DEPENDABOT_LOGIN,
		managed_output: NOT_MANAGED,
		ecosystem: ACTIONS_ECOSYSTEM,
		update_type,
	}
}

describe('dependabot-auto-merge.yml decision — updates that arm', () => {
	it.each([PATCH_UPDATE, MINOR_UPDATE])(
		'arms a github-actions %s update to a workflow the consumer owns',
		(update_type) => {
			expect(is_armed(consumer_owned_bump(update_type))).toBe(true)
		},
	)
})

describe('dependabot-auto-merge.yml decision — updates that do not', () => {
	it('never arms a github-actions major update', () => {
		expect(is_armed(consumer_owned_bump(MAJOR_UPDATE))).toBe(false)
	})

	// The distributed `.github/dependabot.yml` disables npm version updates, so the only npm pull
	// request that reaches this workflow is a security advisory — the kind a human should read.
	it.each([PATCH_UPDATE, MINOR_UPDATE, MAJOR_UPDATE])(
		'never arms an npm %s update',
		(update_type) => {
			expect(is_armed({ ...consumer_owned_bump(update_type), ecosystem: NPM_ECOSYSTEM })).toBe(
				false,
			)
		},
	)
})

// One row per round of this file's history. Each closed a route into an armed pull request nobody
// re-approved; each is now the same question asked of the same expression.
describe('dependabot-auto-merge.yml decision — the routes each fix closed', () => {
	// joshuafolkken/kit#836: a bump to a workflow an upstream package overwrites is written back by
	// the next sync, so merging it only starts a loop. The metadata step no longer skips such a diff —
	// it runs unconditionally now — and the managed clause is what holds the bump back.
	it('#836 — never arms a bump to an upstream-managed workflow', () => {
		expect(is_armed({ ...consumer_owned_bump(PATCH_UPDATE), managed_output: MANAGED })).toBe(false)
	})

	// joshuafolkken/kit#838: the same pull request after a push that added an upstream-managed
	// workflow to its diff. The decision is re-made from the current diff on every run, so the run
	// that sees the managed file reconciles the armed state away.
	it('#838 — stops arming once a managed workflow enters the diff', () => {
		expect(is_armed({ ...consumer_owned_bump(MINOR_UPDATE), managed_output: MANAGED })).toBe(false)
	})

	// joshuafolkken/kit#840: a push by anyone other than Dependabot carries commits nobody reviewed
	// as part of the bump, whatever the diff touches.
	it('#840 — never arms on a push by anyone other than Dependabot', () => {
		expect(is_armed({ ...consumer_owned_bump(PATCH_UPDATE), actor: MAINTAINER_LOGIN })).toBe(false)
	})

	// joshuafolkken/kit#840, the other half: a step that failed publishes no outputs, and a missing
	// input makes every chain that names it false. Nothing is armed on an answer that was never
	// given — what each failure costs beyond that is the entitlement group below.
	it.each([
		['the upstream-managed check', { managed_output: NO_OUTPUT }],
		['the metadata action', { ecosystem: NO_OUTPUT, update_type: NO_OUTPUT }],
	])('never arms when %s published nothing', (_label, missing) => {
		expect(is_armed({ ...consumer_owned_bump(PATCH_UPDATE), ...missing })).toBe(false)
	})
})

// Two declarations, because there are genuinely two questions — and the old design's mistake was
// conflating them into a pair of complements nothing enforced. What holds these together is
// containment rather than convention: qualifying is entitlement plus the facts about the bump.
describe('dependabot-auto-merge.yml decision — entitlement versus qualification', () => {
	// Held by evaluation, not by matching the one text inside the other. A substring assertion passes
	// on `(<entitlement> && …) || github.actor == 'someone-else'`, which keeps the entitlement text
	// intact while arming runs that have none — the #838/#840 regression class, waved straight
	// through. Every combination is checked instead, so no rewriting of either expression can arm a
	// run the withdrawal would then take back.
	it('never arms a run that is not entitled, over every combination', () => {
		expect(runs_armed_without_entitlement()).toEqual([])
	})

	// The sweep can only cover the inputs the context models, and an expression is free to read paths
	// the context does not carry: GitHub renders a missing reference as the empty string, so a clause
	// added on `github.event.pull_request.user.login` would evaluate false here and the sweep would
	// report no escape while the workflow armed every Dependabot-authored pull request. Listing the
	// paths the sweep models and refusing any other is what makes its coverage a fact rather than a
	// claim: a decision that reads something new fails here until the context models it too.
	it('reads only the inputs the sweep varies', () => {
		expect(referenced_paths()).toEqual(MODELLED_PATHS)
	})

	// Guards the sweep above against passing because it swept nothing, and against a values list that
	// stopped tracking what the expressions actually mention.
	it('sweeps a matrix that actually contains runs which arm', () => {
		expect(every_run().some((run) => is_armed(run))).toBe(true)
		expect(swept_values()).toContain(DEPENDABOT_LOGIN)
		expect(swept_values()).toContain(ACTIONS_ECOSYSTEM)
	})

	// The case the split exists for. An npm advisory or a major bump does not qualify for auto-merge,
	// but the run is still entitled to decide — so an auto-merge a maintainer read the bump and
	// enabled by hand is left alone rather than stripped, which would strand the pull request green,
	// mergeable and unmerged (joshuafolkken/kit#834).
	it.each([
		['an npm advisory', { ecosystem: NPM_ECOSYSTEM }],
		['a github-actions major', { update_type: MAJOR_UPDATE }],
	])('stays entitled on %s that does not qualify', (_label, bump) => {
		const run = { ...consumer_owned_bump(PATCH_UPDATE), ...bump }

		expect(is_armed(run)).toBe(false)
		expect(may_arm(run)).toBe(true)
	})

	// What the withdrawal actually keys on: the run-level facts, each of which is a route an earlier
	// round closed.
	it.each([
		['an upstream-managed workflow entered the diff', { managed_output: MANAGED }],
		['someone other than Dependabot pushed', { actor: MAINTAINER_LOGIN }],
		['the upstream-managed check could not answer', { managed_output: NO_OUTPUT }],
	])('loses entitlement when %s', (_label, run) => {
		expect(may_arm({ ...consumer_owned_bump(PATCH_UPDATE), ...run })).toBe(false)
	})

	// The metadata inputs are deliberately absent from entitlement, so a metadata action that could
	// not answer costs qualification alone. An arm an earlier run made is left in place: that run did
	// verify the ecosystem and the semver level, and neither changes over a pull request's life, so
	// withdrawing would strip a good arm every time the action has a bad day.
	it('keeps entitlement when only the metadata action could not answer', () => {
		const undecided = { ecosystem: NO_OUTPUT, update_type: NO_OUTPUT }
		const run = { ...consumer_owned_bump(PATCH_UPDATE), ...undecided }

		expect(is_armed(run)).toBe(false)
		expect(may_arm(run)).toBe(true)
	})
})
