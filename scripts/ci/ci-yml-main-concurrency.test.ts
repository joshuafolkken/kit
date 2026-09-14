import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'
import { workflow_expression_fixture, type ContextTree } from './workflow-expression-fixture'

// `github.ref` is `refs/heads/main` for every push to main, so one concurrency group held all of
// them and each push cancelled the run before it. That was harmless while a release was one bump
// per merge and merges were ten minutes apart; since joshuafolkken/kit#1169 a release is a single
// bump commit and joshuafolkken/kit#1170 merges several lanes at once, so the one run that would
// dispatch `ci-passed-on-main` for a release can be cancelled — losing the tag, the publish and the
// deployment with nothing reported as failed (joshuafolkken/kit#1481).
//
// The group is evaluated with GitHub's own expression engine rather than matched as a string: a
// text match proves only that the clause was written. Only an evaluation proves that two commits on
// main resolve to different groups while two pushes to one pull request still resolve to the same
// one — which is the pair of properties this block has to hold at once.
const { TEMPLATE_CI_YML, RUNTIME_CI_YML } = ci_yml_fixture

const WORKFLOW_NAME = 'CI'
const MAIN_REF = 'refs/heads/main'
const FIRST_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SECOND_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const PULL_NUMBER = 12
const OTHER_PULL_NUMBER = 34

// Both copies, because kit distributes the template and keeps its own runtime workflow: a fix made
// to one of them leaves the other cancelling its main runs while every guard written against "the
// workflow" still passes.
const WORKFLOWS = [
	{ label: 'the distributed template', path: TEMPLATE_CI_YML },
	{ label: "kit's own workflow", path: RUNTIME_CI_YML },
]

function group_for(path: string, github: ContextTree): string {
	const context: ContextTree = {
		[workflow_expression_fixture.GITHUB_CONTEXT]: { workflow: WORKFLOW_NAME, ...github },
	}

	return workflow_expression_fixture.evaluate_template(
		ci_yml_fixture.workflow_concurrency(path).group ?? '',
		context,
	)
}

function push_group(path: string, sha: string): string {
	return group_for(path, { event_name: 'push', ref: MAIN_REF, sha })
}

// A `pull_request` run is checked out at the merge ref, so its `github.sha` is the merge commit —
// a different value on every push to the branch, which is exactly why the sha must not reach the
// group here.
function pull_request_group(path: string, pull_number: number, sha: string): string {
	const merge_reference = `refs/pull/${String(pull_number)}/merge`

	return group_for(path, { event_name: 'pull_request', ref: merge_reference, sha })
}

describe('ci.yml concurrency for a push to main', () => {
	it.each(WORKFLOWS)('gives each commit on main a group of its own in $label', ({ path }) => {
		expect(push_group(path, FIRST_SHA)).not.toBe(push_group(path, SECOND_SHA))
	})

	// Spelled out rather than only compared, so a group that separated the runs by dropping the ref
	// — which would collide with a tag or a release branch pushing the same commit — fails here.
	it.each(WORKFLOWS)('keeps the branch beside the commit in $label', ({ path }) => {
		expect(push_group(path, FIRST_SHA)).toBe(`${WORKFLOW_NAME}-${MAIN_REF}-${FIRST_SHA}`)
	})
})

describe('ci.yml concurrency for a pull request', () => {
	// The saving the block exists for, and what an unconditional `github.sha` would have cost.
	it.each(WORKFLOWS)(
		'still cancels an older run on the same pull request in $label',
		({ path }) => {
			expect(pull_request_group(path, PULL_NUMBER, FIRST_SHA)).toBe(
				pull_request_group(path, PULL_NUMBER, SECOND_SHA),
			)
		},
	)

	it.each(WORKFLOWS)('leaves two pull requests in groups of their own in $label', ({ path }) => {
		expect(pull_request_group(path, PULL_NUMBER, FIRST_SHA)).not.toBe(
			pull_request_group(path, OTHER_PULL_NUMBER, FIRST_SHA),
		)
	})

	it.each(WORKFLOWS)('never shares a group with a push to main in $label', ({ path }) => {
		expect(pull_request_group(path, PULL_NUMBER, FIRST_SHA)).not.toBe(push_group(path, FIRST_SHA))
	})
})

describe('ci.yml cancel-in-progress', () => {
	// Without this the group queues a superseded pull-request run rather than stopping it, so the
	// separation above would buy nothing on the side that still wants cancelling.
	it.each(WORKFLOWS)('cancels a superseded run rather than queueing it in $label', ({ path }) => {
		expect(ci_yml_fixture.concurrency_cancels_in_progress(path)).toBe(true)
	})
})
