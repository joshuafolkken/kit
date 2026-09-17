import { afterAll, describe, expect, it } from 'vitest'
import { reconcile_script_fixture } from './dependabot-reconcile-script-fixture'

const {
	ARM_CALL,
	ARMED_MARKER,
	ARMED_QUERY,
	COMMENT_COMMAND,
	FALSE,
	METADATA_SILENT,
	ARMED_NOTICE_TEXT,
	NOTHING,
	TRUE,
	WITHDRAWN_MARKER,
	WITHDRAW_CALL,
	UNKNOWN_OUTCOME,
	call_count,
	notice_marker,
	posted_body,
	remove_workspace,
	run_reconcile,
	withdraw_attempts,
} = reconcile_script_fixture

afterAll(remove_workspace)

// The arm-versus-withdraw choice and the retry policy both live in the reconciling step's shell, not
// in an expression, so these guards run the script rather than matching substrings in it: the step
// count, the read-before-write ordering and the `--match-head-commit` placement all still hold when
// the script arms exactly the bumps it should withdraw.

describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — which direction it takes',
	() => {
		// The ordinary case the distribution exists for.
		it('arms a qualifying bump that is not yet armed', () => {
			expect(
				run_reconcile({ should_be_armed: TRUE, may_arm: TRUE, is_armed: false }).direction,
			).toBe(ARMED_MARKER)
		})

		// `--auto` on a pull request already armed is a needless write.
		it('does nothing when a qualifying bump is already armed', () => {
			expect(
				run_reconcile({ should_be_armed: TRUE, may_arm: TRUE, is_armed: true }).direction,
			).toBe(NOTHING)
		})
	},
)

// What the script takes back, and what it deliberately does not.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — what it withdraws',
	() => {
		// The route joshuafolkken/kit#838 and #840 closed: the run is no longer entitled to decide, so an
		// arm an earlier run left behind is taken back.
		it('withdraws when the run is no longer entitled to arm', () => {
			expect(
				run_reconcile({ should_be_armed: FALSE, may_arm: FALSE, is_armed: true }).direction,
			).toBe(WITHDRAWN_MARKER)
		})

		// `--disable-auto` is an error, not a no-op, on a pull request that has none.
		it('does nothing when there is nothing to withdraw', () => {
			expect(
				run_reconcile({ should_be_armed: FALSE, may_arm: FALSE, is_armed: false }).direction,
			).toBe(NOTHING)
		})

		// A hand-armed bump is taken back once the run loses its entitlement — a push nobody reviewed as
		// part of the bump is exactly the case joshuafolkken/kit#840 closed, and who armed it earlier
		// does not make the new commits reviewed. Only the qualification half spares it.
		it('withdraws a hand-armed bump once the run is not entitled', () => {
			expect(
				run_reconcile({ should_be_armed: FALSE, may_arm: FALSE, is_armed: true }).direction,
			).toBe(WITHDRAWN_MARKER)
		})

		// The case the entitlement split exists for: an npm advisory or a major bump a maintainer read
		// and armed by hand, on a run that is still entitled. It does not qualify for auto-merge, and
		// undoing a human's decision there would strand the pull request green, mergeable and unmerged.
		it('leaves a hand-armed bump alone when it merely does not qualify', () => {
			expect(
				run_reconcile({ should_be_armed: FALSE, may_arm: TRUE, is_armed: true }).direction,
			).toBe(NOTHING)
		})

		// Every missing input makes both chains false, so an undecidable run reconciles toward "not
		// armed" — and, having lost its entitlement with them, takes back an arm it finds.
		it('withdraws when the decision could not be made at all', () => {
			expect(
				run_reconcile({ should_be_armed: NOTHING, may_arm: NOTHING, is_armed: true }).direction,
			).toBe(WITHDRAWN_MARKER)
		})
	},
)

// A metadata action that is broken rather than merely unsatisfied looks identical from the outside:
// nothing arms, nothing is withdrawn, the job is green. The run says which it was, so a repository
// where every bump has quietly stopped merging has something to read.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — what it says about why',
	() => {
		it('names the metadata step when that is why it could not verify the bump', () => {
			const outcome = run_reconcile({
				should_be_armed: FALSE,
				may_arm: TRUE,
				is_armed: false,
				metadata_answered: FALSE,
			})

			expect(outcome.stderr).toContain(METADATA_SILENT)
		})

		it('does not blame the metadata step for a bump that simply does not qualify', () => {
			const outcome = run_reconcile({ should_be_armed: FALSE, may_arm: TRUE, is_armed: false })

			expect(outcome.stderr).not.toContain(METADATA_SILENT)
		})
	},
)

// joshuafolkken/kit#846. The withdrawal is the direction whose failure is dangerous: this workflow is
// not a required check, so a red run does not hold back a merge that a still-armed auto-merge will
// perform. Retrying is what handles a transient failure; the comment is what keeps a lasting one from
// being silent.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — a gh call that fails',
	() => {
		it('withdraws anyway when the API recovers within the retries', () => {
			const outcome = run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_merges: withdraw_attempts() - 1,
			})

			expect(outcome.direction).toBe(WITHDRAWN_MARKER)
			expect(call_count(WITHDRAW_CALL)).toBe(withdraw_attempts())
		})

		// Reading the state is what tells the withdrawal there is anything to withdraw, so it retries
		// on the same terms.
		it('reads the state again when that is what failed', () => {
			const outcome = run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_reads: withdraw_attempts() - 1,
			})

			expect(outcome.direction).toBe(WITHDRAWN_MARKER)
			expect(call_count(ARMED_QUERY)).toBe(withdraw_attempts())
		})
	},
)

// What it does once the retries are spent. Arming and withdrawing part company here: one leaves the
// bump open for a human, the other leaves an auto-merge armed on a diff nobody re-approved.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — a gh call that keeps failing',
	() => {
		// The hole joshuafolkken/kit#846 names: the read used to abort the step, so `--disable-auto` was
		// never reached and an armed auto-merge survived on a diff nobody re-approved.
		it('still tries to withdraw when the state stayed unreadable', () => {
			const outcome = run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_reads: withdraw_attempts(),
			})

			expect(outcome.direction).toBe(WITHDRAWN_MARKER)
		})

		// Arming is the one move that cannot be taken back, so an unreadable state refuses instead.
		it('refuses to arm when the state stayed unreadable', () => {
			const outcome = run_reconcile({
				should_be_armed: TRUE,
				may_arm: TRUE,
				is_armed: false,
				fail_reads: withdraw_attempts(),
				expect_failure: true,
			})

			expect(outcome.direction).toBe(NOTHING)
			expect(outcome.stderr).toContain('Refusing to arm')
		})
	},
)

// The safe direction, kept cheap on purpose, and the loud end of the dangerous one.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — what it costs to give up',
	() => {
		// A run that does not arm leaves the bump open for a human, which is the safe side — so it
		// costs one attempt and a red step, not a retry loop.
		it('does not retry the arming call', () => {
			run_reconcile({
				should_be_armed: TRUE,
				may_arm: TRUE,
				is_armed: false,
				fail_merges: withdraw_attempts(),
				expect_failure: true,
			})

			expect(call_count(ARM_CALL)).toBe(1)
		})

		it('says so on the pull request when the withdrawal never succeeds', () => {
			const outcome = run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_merges: withdraw_attempts(),
				expect_failure: true,
			})

			expect(call_count(COMMENT_COMMAND)).toBe(1)
			expect(outcome.stderr).not.toContain('Could not leave a comment')
		})
	},
)

// What the confirmation read after a failed withdrawal changes, and what it must not.
describe.skipIf(process.platform === 'win32')(
	'dependabot-auto-merge.yml reconcile script — the confirmation read',
	() => {
		// The confirmation read runs after the withdrawal failed, and a failed one must not downgrade
		// a state this run positively read — the notice would then say less than the run knows.
		it('keeps what it read when the confirmation could not be made', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				// The first read answers; every read after it — the confirmation — does not.
				fail_state_reads_from: 2,
				fail_merges: withdraw_attempts(),
				expect_failure: true,
			})

			expect(posted_body()).toContain(ARMED_NOTICE_TEXT)
		})

		// Re-running the job after a blip is the case the dedup exists for, and also the case where a
		// run can learn more: "confirmed armed and not disarmed" is worth saying even where the weaker
		// "state unknown" already stands, so the marker names the outcome as well as the head.
		it('reports again when this run learned more than the notice already there', () => {
			run_reconcile({
				should_be_armed: FALSE,
				may_arm: FALSE,
				is_armed: true,
				fail_merges: withdraw_attempts(),
				posted_notice: notice_marker(UNKNOWN_OUTCOME),
				expect_failure: true,
			})

			expect(call_count(COMMENT_COMMAND)).toBe(1)
			expect(posted_body()).toContain(ARMED_NOTICE_TEXT)
		})
	},
)
