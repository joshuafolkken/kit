import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch } from './detached-launch'
import { run_ship_review } from './run-ship-review'

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
// **Every failure returns control to the agent**: a non-zero step, a reviewer that did not finish, an
// unreadable findings file, and a High or Medium finding — recorded first, because the round was
// attested, then routed back so the fix and the round-2 decision stay the agent's.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const should_forward_stderr = true
const RUN_REVIEW = 'run:review'
const BRIEF_PREFIX = 'josh-ship-review-brief-'
const FINDINGS_PREFIX = 'josh-ship-review-findings-'
const LOG_PREFIX = 'josh-ship-review-log-'
const BRIEF_SUFFIX = '.md'
const FINDINGS_SUFFIX = '.txt'
const LOG_SUFFIX = '.log'
const CLEAN_NOTE = 'review clean or Low-only — recorded; shipping on.'
const BLOCKING_NOTE =
	'review found High/Medium — recorded; fix them, then take the round-2 route (`chain-rule.md`).'

type Phase = () => Promise<JoshResult>

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
// subagent is given — and waited on, so the join below runs only once the review has finished.
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
async function launch_reviewer(brief: string): Promise<JoshResult> {
	const target = paths()

	stamp_file.write_text_stamp(target.brief, brief)
	stamp_file.remove_stamp(target.findings)

	const prompt = run_ship_review.reviewer_prompt(target.brief, target.findings)

	return await run_session(prompt, target.log)
}

async function record_and_route(issue: string): Promise<JoshResult> {
	const verdict = run_ship_review.read_verdict(stamp_file.read_stamp_text(paths().findings))

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return failure(verdict.note)

	const recorded = await josh(['review:record', '--issue', issue, ...verdict.specs])

	if (recorded.code !== SUCCESS_EXIT_CODE) return recorded

	const listing = [...verdict.specs].join('\n')

	return verdict.kind === run_ship_review.VERDICT.BLOCKING
		? failure(`${listing}\n${BLOCKING_NOTE}`)
		: { code: SUCCESS_EXIT_CODE, out: [listing, CLEAN_NOTE].filter(Boolean).join('\n') }
}

async function run_phases(phases: ReadonlyArray<Phase>): Promise<JoshResult> {
	let last: JoshResult = { code: SUCCESS_EXIT_CODE, out: '' }

	for (const phase of phases) {
		last = await phase()
		if (last.code !== SUCCESS_EXIT_CODE) return last
	}

	return last
}

// The round-1 review, beside the gate: open → review → join → attest → record, stopping at the first
// that did not pass.
async function review_stage(issue: string): Promise<JoshResult> {
	const opened = { brief: '' }

	return await run_phases([
		async () => {
			const result = await josh([RUN_REVIEW])

			opened.brief = result.out

			return result
		},
		async () => await launch_reviewer(opened.brief),
		async () => await josh([RUN_REVIEW, '--join']),
		async () => await josh(['review:attest', '--check']),
		async () => await record_and_route(issue),
	])
}

const run_ship_review_steps = { paths, review_stage }

export { run_ship_review_steps }
