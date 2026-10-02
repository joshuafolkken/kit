import { readFile } from 'node:fs/promises'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_branch } from '#scripts/git/git-branch'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_preflight } from '#scripts/git/git-preflight'
import type { JoshResult } from '#scripts/josh/josh-run'
import { error_text } from '#scripts/lib/error-message'
import { live_evidence } from '#scripts/review/live-evidence'
import { run_ship_scoped } from './run-ship-scoped'

// `josh ship`'s first stage (joshuafolkken/kit#2946). A detached ship used to meet the pull request's
// preconditions only at the commit stage — `git -y`'s preflight — or at the merge — `followup`'s
// live-evidence refusal — each after the review and the gate had already run, so every such stop
// relaunched a session to repeat them. **Every precondition decidable before the review is asked here,
// and all of them are reported at once.** No check is new: the classification, issue and branch answers
// are `git_preflight.problems_of`, and the evidence answer is `live_evidence.verdict_for` over the same
// changed paths and the body this ship will deliver — `--body-file` when given, else the open PR's.
//
// The scoped pair runs last, met rather than stopped on (`run-ship-scoped.ts`), so the review and the
// gate start on a tree both checks are green on.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const EVIDENCE_PROBLEM = `This change touches runtime code, but the PR body has no ${live_evidence.EVIDENCE_HEADING} section: run the acceptance criteria for real and pass the body with --body-file <path>.`

interface PreflightRequest {
	title: string
	body_path: string | undefined
}

async function body_text(body_path: string | undefined): Promise<string | undefined> {
	if (body_path !== undefined) return await readFile(body_path, 'utf8')

	return await git_gh_command.pr_get_body(await git_branch.current())
}

async function evidence_problems(body_path: string | undefined): Promise<Array<string>> {
	const [paths, body] = await Promise.all([
		changed_paths.read_changed_paths(false),
		body_text(body_path),
	])

	return live_evidence.verdict_for(paths, body) === 'required' ? [EVIDENCE_PROBLEM] : []
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

async function asked_problems(request: PreflightRequest): Promise<Array<string>> {
	const [preflight, evidence] = await Promise.all([
		caught(git_preflight.problems_of({ cli_input: request.title, will_open_pr: true })),
		caught(evidence_problems(request.body_path)),
	])

	return [...preflight, ...evidence]
}

async function stage(request: PreflightRequest): Promise<JoshResult> {
	const problems = await asked_problems(request)

	if (problems.length > 0) return refusal(problems)

	const scoped = await run_ship_scoped.scoped_pair()

	return scoped.code === SUCCESS_EXIT_CODE ? { code: SUCCESS_EXIT_CODE, out: 'ready' } : scoped
}

const run_ship_preflight = { EVIDENCE_PROBLEM, stage }

export type { PreflightRequest }
export { run_ship_preflight }
