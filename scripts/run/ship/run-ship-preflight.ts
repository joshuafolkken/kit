import { readFile } from 'node:fs/promises'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_pr } from '#scripts/gh/git-pr'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_branch } from '#scripts/git/git-branch'
import { git_preflight } from '#scripts/git/git-preflight'
import type { JoshResult } from '#scripts/josh/josh-run'
import { error_text } from '#scripts/lib/error-message'
import { live_evidence } from '#scripts/review/live-evidence'
import { run_ship_lock } from './run-ship-lock'
import { run_ship_scoped } from './run-ship-scoped'

// `josh ship`'s first stage. The commit stage (`git -y`'s preflight) and the merge (`followup`'s
// live-evidence refusal) run after the review and the gate, so a stop there would repeat them.
// **Every precondition decidable before the review is asked here, and all of them are reported at
// once.** No check is new: the classification, issue and branch answers
// are `git_preflight.problems_of`, and the evidence answer is `live_evidence.verdict_for` over the same
// changed paths and the body this ship will deliver — `--body-file` when given, else the open PR's.
//
// The scoped pair runs last, met rather than stopped on (`run-ship-scoped.ts`), so the review and the
// gate start on a tree both checks are green on.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const EVIDENCE_PROBLEM = `This change touches runtime code, but the PR body has no ${live_evidence.EVIDENCE_HEADING} section: run the acceptance criteria for real and pass the body with --body-file <path>. Write it ${live_evidence.EVIDENCE_FORMAT}`
const EVIDENCE_PENDING = `This change touches runtime code and no PR is open yet: write the ${live_evidence.EVIDENCE_HEADING} section to a file and hand it to josh ship with --body-file <path>, or the ship refuses. Write it ${live_evidence.EVIDENCE_FORMAT}`

interface PreflightRequest {
	title: string
	body_path: string | undefined
}

async function body_text(body_path: string | undefined): Promise<string | undefined> {
	if (body_path !== undefined) return await readFile(body_path, 'utf8')

	return await git_gh_command.pr_get_body(await git_branch.current())
}

// `no_body_problem` answers a runtime change with no body to read at all — no `--body-file` and no open
// PR, which is every run before its ship opens one.
async function evidence_problems(
	body_path: string | undefined,
	no_body_problem: string = EVIDENCE_PROBLEM,
): Promise<Array<string>> {
	const [paths, body] = await Promise.all([
		changed_paths.read_changed_paths(false),
		body_text(body_path),
	])

	if (live_evidence.verdict_for(paths, body) !== 'required') return []

	return [body === undefined ? no_body_problem : EVIDENCE_PROBLEM]
}

function refusal(problems: ReadonlyArray<string>): JoshResult {
	const lines = problems.map((problem) => `  - ${problem}`)
	const head = `${String(problems.length)} pull-request precondition(s) unmet before the review and the gate:`

	return { code: FAILURE_EXIT_CODE, out: [head, ...lines].join('\n') }
}

// The reads here run in the ship's own process, where the commit stage's ran in a `git -y` child: a
// throw — a `--body-file` path that does not exist, a git read that failed — would escape `ship()`
// past the stop a supervised ship hands back on, so it is reported as one more unmet precondition.
// Each side is caught on its own, so one side's failed read never hides what the other side found.
async function caught(problems: Promise<Array<string>>): Promise<Array<string>> {
	try {
		return await problems
	} catch (error) {
		return [error_text.message_of(error)]
	}
}

// The lock file is asked here too, so a drift stops the ship before the gate
// rather than being rewritten by the pre-push hook's install under the push.
async function asked_problems(request: PreflightRequest): Promise<Array<string>> {
	const [preflight, evidence, lock] = await Promise.all([
		caught(git_preflight.problems_of({ cli_input: request.title, will_open_pr: true })),
		caught(evidence_problems(request.body_path)),
		caught(run_ship_lock.lock_problems()),
	])

	return [...preflight, ...evidence, ...lock]
}

async function stage(request: PreflightRequest): Promise<JoshResult> {
	const problems = await asked_problems(request)

	if (problems.length > 0) return refusal(problems)

	const scoped = await run_ship_scoped.scoped_pair()

	return scoped.code === SUCCESS_EXIT_CODE ? { code: SUCCESS_EXIT_CODE, out: 'ready' } : scoped
}

async function classification_problems(issue_number: string): Promise<Array<string>> {
	await git_pr.release_classification(issue_number, await git_branch.current())

	return []
}

// **The same two refusals, asked before the ship rather than by it**: a missing
// classification or missing evidence is known long before the ship, yet refused there at the run's
// largest context. `run:prep` (and so `run:entry`)
// and `run:step` print this, so the Issue body and the evidence are met while they are cheap. Nothing
// here replaces `stage`: the ship and `followup` still refuse on both. Before the PR exists the evidence
// can only live in the file the ship will be handed, so it is asked for as that file, not reported as a
// body that already failed.
async function ahead(issue_number: string): Promise<Array<string>> {
	const [classification, evidence] = await Promise.all([
		caught(classification_problems(issue_number)),
		caught(evidence_problems(undefined, EVIDENCE_PENDING)),
	])

	return [...classification, ...evidence]
}

const run_ship_preflight = { EVIDENCE_PENDING, EVIDENCE_PROBLEM, ahead, stage }

export type { PreflightRequest }
export { run_ship_preflight }
