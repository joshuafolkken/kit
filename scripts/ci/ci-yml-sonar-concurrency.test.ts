import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'
import { workflow_expression_fixture, type ContextTree } from './workflow-expression-fixture'

// sonar-qube.yml had no `concurrency` block, so a new push to a pull request left the previous
// commit's scan (fetch-depth: 0, sonar.qualitygate.wait=true, ~106s) running to the end while it
// waited to merge (joshuafolkken/kit#2025). The block is copied from ci.yml, so it has to hold the
// same pair of properties: two commits on main resolve to different groups (a release run is never
// cancelled) while two pushes to one pull request resolve to the same one (the superseded scan is).
//
// The group is evaluated with GitHub's own expression engine rather than matched as a string: a
// text match proves only that the clause was written, not that it separates the runs it must.
//
// sonar-qube.yml is distributed to consumers as a byte-copy rather than from a template, so the one
// runtime workflow is the single source and there is no second copy to guard.
const SONAR_YML = '.github/workflows/sonar-qube.yml'
const WORKFLOW_NAME = 'SonarQube'
const MAIN_REF = 'refs/heads/main'
const FIRST_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SECOND_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const PULL_NUMBER = 12
const OTHER_PULL_NUMBER = 34

function group_for(github: ContextTree): string {
	const context: ContextTree = {
		[workflow_expression_fixture.GITHUB_CONTEXT]: { workflow: WORKFLOW_NAME, ...github },
	}

	return workflow_expression_fixture.evaluate_template(
		ci_yml_fixture.workflow_concurrency(SONAR_YML).group ?? '',
		context,
	)
}

function push_group(sha: string): string {
	return group_for({ event_name: 'push', ref: MAIN_REF, sha })
}

// A `pull_request` run is checked out at the merge ref, so its `github.sha` is the merge commit — a
// different value on every push to the branch, which is why the sha must not reach the group here.
function pull_request_group(pull_number: number, sha: string): string {
	const merge_reference = `refs/pull/${String(pull_number)}/merge`

	return group_for({ event_name: 'pull_request', ref: merge_reference, sha })
}

describe('sonar-qube.yml concurrency for a push to main', () => {
	it('gives each commit on main a group of its own', () => {
		expect(push_group(FIRST_SHA)).not.toBe(push_group(SECOND_SHA))
	})

	it('keeps the branch beside the commit', () => {
		expect(push_group(FIRST_SHA)).toBe(`${WORKFLOW_NAME}-${MAIN_REF}-${FIRST_SHA}`)
	})
})

describe('sonar-qube.yml concurrency for a pull request', () => {
	it('still cancels an older scan on the same pull request', () => {
		expect(pull_request_group(PULL_NUMBER, FIRST_SHA)).toBe(
			pull_request_group(PULL_NUMBER, SECOND_SHA),
		)
	})

	it('leaves two pull requests in groups of their own', () => {
		expect(pull_request_group(PULL_NUMBER, FIRST_SHA)).not.toBe(
			pull_request_group(OTHER_PULL_NUMBER, FIRST_SHA),
		)
	})

	it('never shares a group with a push to main', () => {
		expect(pull_request_group(PULL_NUMBER, FIRST_SHA)).not.toBe(push_group(FIRST_SHA))
	})
})

describe('sonar-qube.yml cancel-in-progress', () => {
	it('cancels a superseded scan rather than queueing it', () => {
		expect(ci_yml_fixture.concurrency_cancels_in_progress(SONAR_YML)).toBe(true)
	})
})
