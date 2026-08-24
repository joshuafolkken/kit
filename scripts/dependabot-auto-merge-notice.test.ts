import { afterAll, describe, expect, it } from 'vitest'
import { reconcile_script_fixture } from './dependabot-reconcile-script-fixture'

const {
	COMMENT_COMMAND,
	FALSE,
	HEAD_SHA,
	LASTING_OUTAGE,
	ARMED_OUTCOME,
	UNKNOWN_OUTCOME,
	call_count,
	notice_marker,
	posted_body,
	run_reconcile,
	withdraw_attempts,
	ARMED_NOTICE_TEXT,
	remove_workspace,
} = reconcile_script_fixture

// Each test file gets its own module instance, so each makes its own workspace and has to clear it.
afterAll(remove_workspace)

// What the notice says, and how often. The run does not always know which failure it hit, and a
// degraded window produces a run per push.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — the notice it leaves',
	() => {
		// The notice says which failure happened. Claiming the auto-merge is still armed when the run
		// could not even read the state would be an assertion nobody verified.
		it('says the auto-merge is enabled when the run read that it was', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_merges: withdraw_attempts(),
				expect_failure: true,
			})

			expect(posted_body()).toContain(ARMED_NOTICE_TEXT)
		})

		it('says the state is unknown when the run could not read it', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_reads: LASTING_OUTAGE,
				fail_merges: withdraw_attempts(),
				expect_failure: true,
			})

			expect(posted_body()).toContain('could not read or change')
		})

		// The lookup that checks for a standing notice is the same call as the state read, so an
		// outage that defeated one defeats the other. The notice is posted anyway: a duplicate comment
		// is the better mistake when the alternative is an armed auto-merge nobody was told about.
		it('posts the notice even when it could not check for one', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_reads: LASTING_OUTAGE,
				fail_merges: withdraw_attempts(),
				posted_notice: notice_marker(UNKNOWN_OUTCOME),
				expect_failure: true,
			})

			expect(call_count(COMMENT_COMMAND)).toBe(1)
		})
	},
)

// How often it says it. A degraded window produces a run per push, and one notice says everything
// several would — but only for as long as the branch stands still.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — how often it leaves a notice',
	() => {
		// The lookup retries like everything else on this path: without that, one blip on the check
		// would post a duplicate of a notice already standing.
		it('checks again for a standing notice when the lookup blipped', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_merges: withdraw_attempts(),
				fail_posted_reads: withdraw_attempts() - 1,
				posted_notice: notice_marker(ARMED_OUTCOME),
				expect_failure: true,
			})

			expect(call_count(COMMENT_COMMAND)).toBe(0)
		})

		// And the notice itself: it is posted during the outage that defeated the withdrawal, so one
		// failure must not be what decides the pull request says nothing.
		it('posts the notice again when the first attempt blipped', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_merges: withdraw_attempts(),
				fail_comments: withdraw_attempts() - 1,
				expect_failure: true,
			})

			expect(call_count(COMMENT_COMMAND)).toBe(withdraw_attempts())
			expect(posted_body()).toContain(ARMED_NOTICE_TEXT)
		})
	},
)

// Whether it repeats itself. A degraded window produces a run per push, and one notice says
// everything several would — but only for as long as the branch stands still and nothing is learned.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — whether it repeats a notice',
	() => {
		it('does not repeat a notice the pull request already carries', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_merges: withdraw_attempts(),
				posted_notice: notice_marker(ARMED_OUTCOME),
				expect_failure: true,
			})

			expect(call_count(COMMENT_COMMAND)).toBe(0)
		})

		// Scoped to the head it was written for. Without that, the first incident on a pull request
		// would silence every later one, and a failure after the branch moved is a fresh incident.
		it('reports again when the branch moved since the last notice', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_merges: withdraw_attempts(),
				posted_notice: notice_marker(ARMED_OUTCOME, 'an-older-head'),
				expect_failure: true,
			})

			expect(call_count(COMMENT_COMMAND)).toBe(1)
			expect(posted_body()).toContain(HEAD_SHA)
		})
	},
)

// When a notice already stands, whether this run has anything new to add.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — when a notice already stands',
	() => {
		// The reverse of the case below: a run that could not read the state adds nothing to a standing
		// notice that did, so an `armed` notice covers an `unknown` one. Only the state read fails
		// here — with the lookup down as well there would be no standing notice to find, and the rule
		// would have nothing to act on.
		it('stays quiet when the notice already there says more than this run knows', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_state_reads: LASTING_OUTAGE,
				fail_merges: withdraw_attempts(),
				posted_notice: notice_marker(ARMED_OUTCOME),
				expect_failure: true,
			})

			expect(call_count(COMMENT_COMMAND)).toBe(0)
		})
	},
)
