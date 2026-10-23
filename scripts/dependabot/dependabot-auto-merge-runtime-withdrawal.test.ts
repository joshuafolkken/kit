import type { WorkflowStep } from '#scripts/ci/ci-yml-fixture'
import { workflow_expression_fixture } from '#scripts/ci/workflow-expression-fixture'
import { afterAll, describe, expect, it } from 'vitest'
import { reconcile_script_fixture, type Case } from './dependabot-reconcile-script-fixture'
import { dependabot_workflow_fixture, type WorkflowRun } from './dependabot-workflow-fixture'

// kit's own arming binds only the head it was made on: GitHub keeps auto-merge on through a later
// push, so a collaborator's commit would merge on the bump's metadata unless kit's copy withdraws it
// (joshuafolkken/kit#4691). These guards hold when the withdrawal runs and what its script does.
const { DEPENDABOT_LOGIN, MAINTAINER_LOGIN, NO_OUTPUT, NOT_MANAGED, ACTIONS_ECOSYSTEM } =
	dependabot_workflow_fixture
const { PATCH_UPDATE, runtime_job, find_step, step_condition, build_run_context } =
	dependabot_workflow_fixture
const { ARMED_QUERY, FALSE, LASTING_OUTAGE, NOTHING, WITHDRAWN_MARKER, WITHDRAW_CALL } =
	reconcile_script_fixture
const { call_count, remove_workspace, run_step, withdraw_attempts } = reconcile_script_fixture

const WITHDRAW_STEP_ID = 'withdraw'
const WITHDRAW_LABEL = 'withdrawal'
// Who the arming step's `github.token` enables auto-merge as.
const WORKFLOW_ARMER = 'github-actions'

afterAll(remove_workspace)

function qualifying_run(actor: string): WorkflowRun {
	return {
		actor,
		managed_output: NOT_MANAGED,
		ecosystem: ACTIONS_ECOSYSTEM,
		update_type: PATCH_UPDATE,
	}
}

function withdraw_step_reached(run: WorkflowRun): boolean {
	const condition = step_condition(find_step(runtime_job(), WITHDRAW_STEP_ID), WITHDRAW_LABEL)

	return workflow_expression_fixture.evaluate_condition(condition, build_run_context(run))
}

function withdraw_step(): WorkflowStep | undefined {
	return find_step(runtime_job(), WITHDRAW_STEP_ID)
}

function run_withdrawal(scenario: Partial<Case>): string {
	const armed_by_kit = { is_armed: true, state_answer: WORKFLOW_ARMER }
	const base = { should_be_armed: FALSE, may_arm: FALSE, ...armed_by_kit }

	return run_step(withdraw_step(), { ...base, ...scenario }).direction
}

describe('kit’s own dependabot-auto-merge.yml — when the withdrawal runs', () => {
	it('runs on a push by anyone but Dependabot', () => {
		expect(withdraw_step_reached(qualifying_run(MAINTAINER_LOGIN))).toBe(true)
	})

	// Dependabot's own push is the one the arming step decides on; withdrawing there would undo it.
	it('does not run on a push by Dependabot', () => {
		expect(withdraw_step_reached(qualifying_run(DEPENDABOT_LOGIN))).toBe(false)
	})

	// The metadata step fails on a maintainer's push, so its silence must not keep the withdrawal off.
	it('runs when the metadata step did not answer', () => {
		const run = {
			...qualifying_run(MAINTAINER_LOGIN),
			ecosystem: NO_OUTPUT,
			update_type: NO_OUTPUT,
		}

		expect(withdraw_step_reached(run)).toBe(true)
	})
})

describe.skipIf(process.platform === 'win32')(
	'kit’s own dependabot-auto-merge.yml — what the withdrawal script does',
	() => {
		// GraphQL names the workflow token `github-actions`; REST appends `[bot]`.
		it.each([WORKFLOW_ARMER, `${WORKFLOW_ARMER}[bot]`])(
			'withdraws an auto-merge armed as %s',
			(armer) => {
				expect(run_withdrawal({ state_answer: armer })).toBe(WITHDRAWN_MARKER)
			},
		)

		// `--disable-auto` errors on a pull request with nothing armed.
		it('leaves a pull request with nothing armed alone', () => {
			expect(run_withdrawal({ is_armed: false, state_answer: NOTHING })).toBe(NOTHING)
			expect(call_count(ARMED_QUERY)).toBe(1)
		})

		// A maintainer who enabled auto-merge by hand, before their push or after it, decided it.
		it('leaves an auto-merge a maintainer enabled by hand alone', () => {
			expect(run_withdrawal({ state_answer: MAINTAINER_LOGIN })).toBe(NOTHING)
		})

		// "Could not tell" is not evidence that there is nothing to take back.
		it('still withdraws when the armed state cannot be read', () => {
			expect(run_withdrawal({ fail_reads: LASTING_OUTAGE })).toBe(WITHDRAWN_MARKER)
		})

		// One transient API error must not leave the auto-merge armed on an unreviewed diff.
		it('withdraws on the last retry after transient failures', () => {
			const attempts = withdraw_attempts(withdraw_step())

			expect(run_withdrawal({ fail_merges: attempts - 1 })).toBe(WITHDRAWN_MARKER)
			expect(call_count(WITHDRAW_CALL)).toBe(attempts)
		})

		// This workflow is not a required check, but a red run is what makes a lasting failure visible.
		it('fails the run when every withdrawal attempt fails', () => {
			run_withdrawal({ fail_merges: LASTING_OUTAGE, expect_failure: true })

			expect(call_count(WITHDRAW_CALL)).toBe(withdraw_attempts(withdraw_step()))
		})
	},
)
