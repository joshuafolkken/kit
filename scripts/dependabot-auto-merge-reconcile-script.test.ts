import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dependabot_workflow_fixture } from './dependabot-workflow-fixture'

// The arm-versus-withdraw choice used to live in step `if:` conditions, which kit's guards evaluate
// with GitHub's own engine. joshuafolkken/kit#845 moved it into the reconciling script, and a guard
// that only matched substrings there would have let an inverted comparison through: the step count,
// the read-before-write ordering and the `--match-head-commit` placement all still hold when the
// script arms exactly the bumps it should withdraw. So the script is run, against a `gh` that records
// what it was asked to do.
const {
	RECONCILE_STEP_ID,
	DECISION_VARIABLE,
	ENTITLEMENT_VARIABLE,
	DIAGNOSTIC_VARIABLE,
	MERGE_COMMAND,
	template_job,
	find_step,
	step_run,
} = dependabot_workflow_fixture

// What the reconciling script did: which direction it took, and what it said about why.
interface Outcome {
	direction: string
	stderr: string
}

const WITHDRAW_COMMAND = 'gh pr merge --disable-auto'
const ARMED_MARKER = 'auto'
const WITHDRAWN_MARKER = 'disable'
const NOTHING = ''
const METADATA_SILENT = 'metadata step did not answer'
const TRUE = 'true'
const FALSE = 'false'

const workspace = mkdtempSync(path.join(tmpdir(), 'reconcile-'))

afterAll(() => {
	rmSync(workspace, { recursive: true, force: true })
})

// Answers `gh pr view` with the armed state the case describes, and records any `gh pr merge` so the
// assertion can name which direction the script took.
function write_gh_stub(is_armed: boolean): string {
	const bin = path.join(workspace, 'bin')
	const stub = path.join(bin, 'gh')

	writeFileSync(path.join(workspace, 'calls'), '')
	mkdirSync(bin, { recursive: true })
	writeFileSync(
		stub,
		[
			'#!/usr/bin/env bash',
			'if [ "$2" = "view" ]; then',
			`  echo '${String(is_armed)}'`,
			'  exit 0',
			'fi',
			`echo "$*" >>"${path.join(workspace, 'calls')}"`,
			'',
		].join('\n'),
	)
	chmodSync(stub, 0o755)

	return bin
}

// Both directions are read, not just the first that matches: a script that armed *and* withdrew is
// the double-write this file exists to catch, and reporting the first hit would hide it.
function directions_taken(): string {
	const calls = readFileSync(path.join(workspace, 'calls'), 'utf8')
	const taken = [
		calls.includes('--disable-auto') ? WITHDRAWN_MARKER : NOTHING,
		calls.includes('--auto --merge') ? ARMED_MARKER : NOTHING,
	].filter(Boolean)

	expect(taken.length).toBeLessThan(2)

	return taken[0] ?? NOTHING
}

interface Case {
	should_be_armed: string
	may_arm: string
	is_armed: boolean
	metadata_answered?: string
}

function run_reconcile(scenario: Case): Outcome {
	const bin = write_gh_stub(scenario.is_armed)
	const script = step_run(find_step(template_job(), RECONCILE_STEP_ID))

	// A renamed step yields the empty script, which bash runs happily and which would make every
	// "does nothing" case below pass without testing anything.
	expect(script).toContain(MERGE_COMMAND)
	expect(script).toContain(WITHDRAW_COMMAND)
	const result = spawnSync('bash', ['-e', '-c', script], {
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${bin}:${process.env['PATH'] ?? ''}`,
			[DECISION_VARIABLE]: scenario.should_be_armed,
			[ENTITLEMENT_VARIABLE]: scenario.may_arm,
			[DIAGNOSTIC_VARIABLE]: scenario.metadata_answered ?? TRUE,
			PR_URL: 'https://example.invalid/pr/1',
			HEAD_SHA: 'cafebabe',
		},
	})

	expect(result.status).toBe(0)

	return { direction: directions_taken(), stderr: result.stderr }
}

// The script is bash and only ever runs on GitHub's ubuntu runners, so there is nothing to assert
// about it on a platform without one.
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
