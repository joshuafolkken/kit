import { readFile } from 'node:fs/promises'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_pr } from '#scripts/gh/git-pr'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_branch } from '#scripts/git/git-branch'
import { git_issue } from '#scripts/git/git-issue'
import { git_preflight, type Unmet } from '#scripts/git/git-preflight'
import type { JoshResult } from '#scripts/josh/josh-run'
import { error_text } from '#scripts/lib/error-message'
import { acceptance_map_check } from '#scripts/review/acceptance-map-check'
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
//
// A stop names the kinds of the preconditions it found unmet, beside the git preflight's own, so the
// lane ledger can count which one stops ships (joshuafolkken/kit#4166).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const UNREADABLE = Symbol('unreadable body')
const PRECONDITION = {
	LIVE_EVIDENCE: 'live-evidence',
	ACCEPTANCE_MAP: 'acceptance-map',
	LOCK: 'lock',
	SCOPED: 'scoped',
	UNREADABLE: 'unreadable',
} as const
const EVIDENCE_PROBLEM = `This change touches runtime code, but the PR body has no ${live_evidence.EVIDENCE_HEADING} section: run the acceptance criteria for real and pass the body with --body-file <path>. Write it ${live_evidence.EVIDENCE_FORMAT}`
const EVIDENCE_PENDING = `This change touches runtime code and no PR is open yet: write the ${live_evidence.EVIDENCE_HEADING} section to a file and hand it to josh ship with --body-file <path>, or the ship refuses. Write it ${live_evidence.EVIDENCE_FORMAT}`

interface PreflightRequest {
	title: string
	body_path: string | undefined
}

// `preconditions` names the kinds a stopped stage found unmet, each once, in the order they were asked.
interface PreflightResult extends JoshResult {
	preconditions?: ReadonlyArray<string>
}

async function body_text(body_path: string | undefined): Promise<string | undefined> {
	if (body_path !== undefined) return await readFile(body_path, 'utf8')

	return await git_gh_command.pr_get_body(await git_branch.current())
}

function of_kind(kind: string, problems: ReadonlyArray<string>): Array<Unmet> {
	return problems.map((problem) => ({ kind, problem }))
}

// `no_body_problem` answers a runtime change with no body to read at all — no `--body-file` and no open
// PR, which is every run before its ship opens one.
async function evidence_problems(
	body_path: string | undefined,
	no_body_problem: string = EVIDENCE_PROBLEM,
): Promise<Array<Unmet>> {
	const [paths, body] = await Promise.all([
		changed_paths.read_changed_paths(false),
		body_text(body_path),
	])

	if (live_evidence.verdict_for(paths, body) !== 'required') return []

	return of_kind(PRECONDITION.LIVE_EVIDENCE, [
		body === undefined ? no_body_problem : EVIDENCE_PROBLEM,
	])
}

function refusal(problems: ReadonlyArray<Unmet>): PreflightResult {
	const lines = problems.map(({ problem }) => `  - ${problem}`)
	const head = `${String(problems.length)} pull-request precondition(s) unmet before the review and the gate:`
	const preconditions = [...new Set(problems.map(({ kind }) => kind))]

	return { code: FAILURE_EXIT_CODE, out: [head, ...lines].join('\n'), preconditions }
}

// The reads here run in the ship's own process, where the commit stage's ran in a `git -y` child: a
// throw — a `--body-file` path that does not exist, a git read that failed — would escape `ship()`
// past the stop a supervised ship hands back on, so it is reported as one more unmet precondition.
// Each side is caught on its own, so one side's failed read never hides what the other side found.
async function caught(problems: Promise<Array<Unmet>>): Promise<Array<Unmet>> {
	try {
		return await problems
	} catch (error) {
		return of_kind(PRECONDITION.UNREADABLE, [error_text.message_of(error)])
	}
}

async function readable_body(
	body_path: string | undefined,
): Promise<string | undefined | typeof UNREADABLE> {
	try {
		return await body_text(body_path)
	} catch {
		return UNREADABLE
	}
}

// `followup`'s acceptance-map refusal, asked of the body this ship will deliver. A branch with no issue
// number is `git_preflight`'s problem to name, and an unreadable body the evidence side's.
async function acceptance_problems(body_path: string | undefined): Promise<Array<Unmet>> {
	const issue = git_issue.branch_number(await git_branch.current())
	const body = await readable_body(body_path)

	if (issue === undefined || body === UNREADABLE) return []
	const problem = await acceptance_map_check.body_refusal(issue, body)

	return problem === undefined ? [] : of_kind(PRECONDITION.ACCEPTANCE_MAP, [problem])
}

async function lock_problems(): Promise<Array<Unmet>> {
	return of_kind(PRECONDITION.LOCK, await run_ship_lock.lock_problems())
}

// The lock file is asked here too, so a drift stops the ship before the gate
// rather than being rewritten by the pre-push hook's install under the push.
async function asked_problems(request: PreflightRequest): Promise<Array<Unmet>> {
	const [preflight, evidence, acceptance, lock] = await Promise.all([
		caught(git_preflight.problems_of({ cli_input: request.title, will_open_pr: true })),
		caught(evidence_problems(request.body_path)),
		caught(acceptance_problems(request.body_path)),
		caught(lock_problems()),
	])

	return [...preflight, ...evidence, ...acceptance, ...lock]
}

async function stage(request: PreflightRequest): Promise<PreflightResult> {
	const problems = await asked_problems(request)

	if (problems.length > 0) return refusal(problems)

	const scoped = await run_ship_scoped.scoped_pair()

	if (scoped.code === SUCCESS_EXIT_CODE) return { code: SUCCESS_EXIT_CODE, out: 'ready' }

	return { ...scoped, preconditions: [PRECONDITION.SCOPED] }
}

async function classification_problems(issue_number: string): Promise<Array<Unmet>> {
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

	return [...classification, ...evidence].map(({ problem }) => problem)
}

const run_ship_preflight = { EVIDENCE_PENDING, EVIDENCE_PROBLEM, ahead, stage }

export type { PreflightRequest, PreflightResult }
export { run_ship_preflight }
