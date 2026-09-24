import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { gate_tree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch } from './detached-launch'
import { run_ship_review, type RoundOutcome, type ScoredVerdict } from './run-ship-review'

// The side effects of `josh ship --review` (joshuafolkken/kit#2427): the round-1 review the chain used
// to open, launch, join, attest and record across five agent turns, run by the supervisor beside the
// gate. Each step is the existing command or mechanism, composed rather than cloned:
//
// 1. `run:review` starts the gate detached and mints the brief — the nonce `review:attest` checks.
// 2. the reviewer is launched the way `run:wake` launches a session — `agent_argv` under the reviewer
//    profile, `detached_launch.launch_attached` to wait for its exit — handed the brief by path.
// 3. `run:review --join` blocks a verdict over a red gate; `review:attest --check` refuses a review
//    that read another checkout; `review:record` writes the round the merge gate reads.
//
// **Round 1's local fixes and round 2 stay inside the supervisor** (joshuafolkken/kit#2489). A round-1
// reviewer that fixed its local Mediums in place changed the tree the background gate read, so that
// join drains the gate rather than judging it — the ship's gate stage re-runs on the fixed tree. After
// the commit, `round_two_stage` asks `review:round2 --round-1-closed` whether the fix delta owes a
// second round, and on `required` runs it through the same commands the chain does: the scoped pair
// `review:brief` requires, `review:brief --round 2`, a fresh reviewer session, attest and record.
//
// **A precondition the supervisor can meet itself is met, not stopped on** (joshuafolkken/kit#2500).
// The scoped pair `run:review` and the local gate refuse without is run in place when this tree has no
// green record, and a round-1 fix is counted only once that pair is green on the fixed tree.
//
// **Every failure returns control to the agent**: a non-zero step, a reviewer that did not finish, an
// unreadable findings file, a High or an unfixed Medium in round 1, and anything but a clean round 2 —
// recorded first, because the round was attested, then routed back.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const should_forward_stderr = true
const RUN_REVIEW = 'run:review'
const ATTEST_CHECK = ['review:attest', '--check']
const ROUND_TWO_DECISION = ['review:round2', '--round-1-closed']
const ROUND_TWO_BRIEF = ['review:brief', '--round', '2']
const ROUND_TWO_REQUIRED = 'required'
const BRIEF_PREFIX = 'josh-ship-review-brief-'
const FINDINGS_PREFIX = 'josh-ship-review-findings-'
const LOG_PREFIX = 'josh-ship-review-log-'
const BRIEF_SUFFIX = '.md'
const FINDINGS_SUFFIX = '.txt'
const LOG_SUFFIX = '.log'
const FIXED_JOIN_NOTE =
	'the round-1 gate read the tree before the review fixes — drained, not judged; the gate stage re-runs it.'
const ROUND_TWO_SKIPPED_NOTE = 'round 2 not due — nothing left to verify; shipping on.'

type Phase = () => Promise<JoshResult>
type PromptOf = (brief_path: string, findings_path: string) => string

function failure(out: string): JoshResult {
	return { code: FAILURE_EXIT_CODE, out }
}

function paths(root: string = PROJECT_ROOT): { brief: string; findings: string; log: string } {
	return {
		brief: stamp_file.stamp_path(BRIEF_PREFIX, root, BRIEF_SUFFIX),
		findings: stamp_file.stamp_path(FINDINGS_PREFIX, root, FINDINGS_SUFFIX),
		log: stamp_file.stamp_path(LOG_PREFIX, root, LOG_SUFFIX),
	}
}

async function josh(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(argv, should_forward_stderr)
}

function note(text: string): void {
	process.stderr.write(`${text}\n`)
}

// Under the reviewer profile — the same model and effort (`JOSH_REVIEWER_*` included) the chain's
// subagent is given — and waited on, so the join below runs only once the review has finished. Each
// call is its own process, so round 2 is a fresh session by construction.
async function run_session(prompt: string, log_path: string): Promise<JoshResult> {
	const built = agent_argv.resolve_in(prompt, agent_role_profile.REVIEWER, PROJECT_ROOT)

	if (built.kind === 'rejected') return failure(`reviewer profile rejected: ${built.note}`)

	const request = { argv: built.argv, cwd: PROJECT_ROOT, log_path, profile: built.profile }
	const result = await detached_launch.launch_attached(request, note)

	if (result.kind === 'failed') return failure(`reviewer could not start: ${result.note}`)
	if (result.exit_code !== SUCCESS_EXIT_CODE) return failure(`reviewer failed — log: ${log_path}`)

	return { code: SUCCESS_EXIT_CODE, out: '' }
}

// The brief goes to a file and the previous round's findings are removed, so a reviewer that writes
// nothing reads as unfinished rather than as the last round's verdict.
async function launch_reviewer(brief: string, prompt_of: PromptOf): Promise<JoshResult> {
	const target = paths()

	stamp_file.write_text_stamp(target.brief, brief)
	stamp_file.remove_stamp(target.findings)

	return await run_session(prompt_of(target.brief, target.findings), target.log)
}

function current_verdict(): ReturnType<typeof run_ship_review.read_verdict> {
	return run_ship_review.read_verdict(stamp_file.read_stamp_text(paths().findings))
}

// A red join blocks unless the reviewer fixed findings in place: the background gate then read the
// tree before the fixes, so its verdict describes a tree that no longer exists. The join still ran to
// its end, so the gate stage that follows never races it.
async function join_gate(): Promise<JoshResult> {
	const joined = await josh([RUN_REVIEW, '--join'])

	if (joined.code === SUCCESS_EXIT_CODE) return joined
	if (current_verdict().kind !== run_ship_review.VERDICT.FIXED) return joined

	note(FIXED_JOIN_NOTE)

	return { code: SUCCESS_EXIT_CODE, out: joined.out }
}

async function record_and_route(
	issue: string,
	outcome_of: (verdict: ScoredVerdict) => RoundOutcome,
): Promise<JoshResult> {
	const verdict = current_verdict()

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return failure(verdict.note)

	const recorded = await josh(['review:record', '--issue', issue, ...verdict.specs])

	if (recorded.code !== SUCCESS_EXIT_CODE) return recorded

	const outcome = outcome_of(verdict)
	const out = [...verdict.specs, outcome.note].join('\n')

	return outcome.is_passing ? { code: SUCCESS_EXIT_CODE, out } : failure(out)
}

async function run_phases(phases: ReadonlyArray<Phase>): Promise<JoshResult> {
	let last: JoshResult = { code: SUCCESS_EXIT_CODE, out: '' }

	for (const phase of phases) {
		last = await phase()
		if (last.code !== SUCCESS_EXIT_CODE) return last
	}

	return last
}

// A brief-minting command, then a reviewer handed what it printed.
function reviewed(open: ReadonlyArray<string>, prompt_of: PromptOf): ReadonlyArray<Phase> {
	const opened = { brief: '' }

	return [
		async () => {
			const result = await josh(open)

			opened.brief = result.out

			return result
		},
		async () => await launch_reviewer(opened.brief, prompt_of),
	]
}

// The scoped pair's precondition, met by the supervisor itself rather than stopped on
// (joshuafolkken/kit#2500): only the checks with no green record for this tree run — the same
// question `review:brief` and the local gate refuse on — so a fresh record costs nothing and a stale
// or absent one costs a scoped run instead of a stop and a relaunched session. A check that genuinely
// fails still stops the ship, its output forwarded to the ship log.
async function scoped_pair(): Promise<JoshResult> {
	const tree = await gate_tree.read_gate_tree()
	const scripts = scoped_green.missing_scripts(tree.files, tree.base)

	return await run_phases(scripts.map((script) => async () => await josh([script])))
}

// Fixes made in place are counted only once the scoped pair is green on the fixed tree. The reviewer is
// asked to leave it green; this is the check that it did, and a fix it could not get green is routed as
// the finding it still is — recorded, then stopped before the gate and the commit take it in.
async function round_one_record(issue: string): Promise<JoshResult> {
	const is_fixed = current_verdict().kind === run_ship_review.VERDICT.FIXED
	const checked = is_fixed ? await scoped_pair() : undefined
	const is_verified = checked === undefined || checked.code === SUCCESS_EXIT_CODE

	return await record_and_route(issue, (verdict) =>
		is_verified ? run_ship_review.round_one_outcome(verdict) : run_ship_review.UNVERIFIED_OUTCOME,
	)
}

// The round-1 review, beside the gate: scoped pair → open → review → join → attest → record, stopping
// at the first that did not pass.
async function review_stage(issue: string): Promise<JoshResult> {
	return await run_phases([
		scoped_pair,
		...reviewed([RUN_REVIEW], run_ship_review.reviewer_prompt),
		join_gate,
		async () => await josh(ATTEST_CHECK),
		async () => await round_one_record(issue),
	])
}

// The round-2 verification pass, after the commit so it runs beside CI: due only when the round-1 fix
// delta says so, then scoped pair → brief → fresh reviewer → attest → record.
async function round_two_stage(issue: string): Promise<JoshResult> {
	const decision = await josh(ROUND_TWO_DECISION)
	const answer = decision.out.trim()

	if (decision.code !== SUCCESS_EXIT_CODE) return decision

	if (answer !== ROUND_TWO_REQUIRED) {
		return { code: SUCCESS_EXIT_CODE, out: `${answer}\n${ROUND_TWO_SKIPPED_NOTE}` }
	}

	return await run_phases([
		scoped_pair,
		...reviewed(ROUND_TWO_BRIEF, run_ship_review.verification_prompt),
		async () => await josh(ATTEST_CHECK),
		async () => await record_and_route(issue, run_ship_review.round_two_outcome),
	])
}

const run_ship_review_steps = { paths, review_stage, round_two_stage }

export { run_ship_review_steps }
