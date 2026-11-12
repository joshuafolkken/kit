#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_body_or_comment } from '#scripts/issue/issue-body-or-comment'
import { PLANNED_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_plan_notify } from '#scripts/issue/issue-plan-notify'
import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { cli_body } from '#scripts/josh/cli-body'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_plan_auto } from '#scripts/lane/lane-plan-auto'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'

// `josh issue:plan <N> --body-file <path> [--title <title>] [--planned]` — record a plan on an issue
// in one call: the title normalized, the plan written into a blank body or posted as a comment, and
// `run:planned` applied.
//
// **`kickoff` and `fullrun` spelled those three writes out by hand** — a `gh api -X PATCH` for the
// title, a second one for a blank body or `issue:comment` otherwise, and a third `gh api` for the
// label — so the blank-body decision lived in three documents. It now lives in
// `issue-body-or-comment.ts`, which `followup`'s completion notice shares.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE =
	'Usage: josh issue:plan <issue-number> --body-file <path> [--title <title>] [--planned] [--no-notify] [--repo <owner/name>]'

interface PlanRequest {
	issue_number: string
	plan: string
	title: string | undefined
	is_planned: boolean
	is_notified: boolean
	repo: string | undefined
}

const OPTIONS = {
	'body-file': { type: 'string' },
	title: { type: 'string' },
	planned: { type: 'boolean' },
	'no-notify': { type: 'boolean' },
	repo: { type: 'string' },
} as const

// The plan is read last, from the path the flags named; an empty plan refuses like a missing one. A
// plan without its existing-consumers section throws its refusal, printed as-is like a read failure,
// before any write (`plan-consumers-section.ts`).
function with_plan(
	flags: Omit<PlanRequest, 'plan'>,
	file_path: string | undefined,
): PlanRequest | undefined {
	if (file_path === undefined) return undefined
	const plan = cli_body.read_file_or_stdin(file_path)

	if (plan.trim().length === 0) return undefined
	const refusal = plan_consumers_section.refusal_of(plan)

	if (refusal !== undefined) throw new Error(refusal)

	return { ...flags, plan }
}

// An optional string flag, trimmed; given blank it is `''`, which the caller refuses.
function trimmed(value: string | undefined): string | undefined {
	return value?.trim()
}

// A `--title` or `--repo` given blank refuses rather than being dropped: the caller meant to rename
// the issue, or to address another repository's — a dropped `--repo` would write to this one's.
function parse_request(argv: ReadonlyArray<string>): PlanRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) return undefined
	const issue_number = issue_number_shape.single_of(parsed.positionals)
	const [title, repo] = [trimmed(parsed.values.title), trimmed(parsed.values.repo)]

	if (issue_number === undefined || [title, repo].includes('')) return undefined
	const is_planned = parsed.values.planned === true
	const is_notified = is_planned && parsed.values['no-notify'] !== true
	const flags = { issue_number, title, is_planned, is_notified, repo }

	return with_plan(flags, parsed.values['body-file'])
}

// A file-read failure surfaces as an `Error` naming the resolved path, printed as-is; `undefined` is
// a malformed call, which `USAGE` explains.
function resolve_request(argv: ReadonlyArray<string>): PlanRequest | undefined {
	try {
		const request = parse_request(argv)

		if (request === undefined) console.error(USAGE)

		return request
	} catch (error) {
		console.error(error_text.message_of(error))

		return undefined
	}
}

// The title goes first, so the plan and the label land on an issue already carrying the name the
// plan was written under; the label goes last, so `run:planned` never marks an issue whose plan
// failed to post.
async function apply_planned_label(issue_number: string, repo?: string): Promise<boolean> {
	const is_applied = await git_gh_command.issue_add_label(issue_number, PLANNED_LABEL, repo)

	if (is_applied) console.info(`label: ${PLANNED_LABEL}`)
	else console.error(`Could not apply ${PLANNED_LABEL} to issue ${issue_number}.`)

	return is_applied
}

// `--repo` addresses every write — the title, the plan and the label — so `kickoff kit#<N>` run from
// another checkout records the plan on the named repository's issue, never on this one's.
async function record_plan(request: PlanRequest): Promise<boolean> {
	const { issue_number, title, repo } = request

	if (title !== undefined) {
		console.info(`title: ${await git_gh_command.issue_edit_title(issue_number, title, repo)}`)
	}

	const posted = await issue_body_or_comment.post(issue_number, request.plan, repo)

	console.info(`${posted.destination}: ${posted.url}`)
	if (!request.is_planned) return true
	const is_applied = await apply_planned_label(issue_number, repo)

	if (is_applied && request.is_notified) await issue_plan_notify.send(request)

	return is_applied
}

// A refused write prints as one line, like a file-read failure, rather than escaping as a stack trace.
async function try_record_plan(request: PlanRequest): Promise<boolean> {
	try {
		return await record_plan(request)
	} catch (error) {
		console.error(error_text.message_of(error))

		return false
	}
}

// True when the plan is the running lane's own: a lane child planning its own issue in this repository.
// Any other plan has no lane to plan — one recorded at `kickoff`, or on another issue, would hold its
// files (or yield them) long before its own lane runs.
function is_own_lane(request: PlanRequest): boolean {
	const is_lane_issue = lane_child_marker.marked_issue() === request.issue_number

	return is_lane_issue && request.repo === undefined && lane_child_marker.is_child_of(process.cwd())
}

// **A lane child's plan runs `lane:plan` on its own paths** (joshuafolkken/kit#5738), its exit code the
// command's, so the child spends no second call copying the paths.
async function lane_plan_code(request: PlanRequest): Promise<number> {
	if (!is_own_lane(request)) return SUCCESS_EXIT_CODE

	return await lane_plan_auto.run_from_plan(request.issue_number, request.plan)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = resolve_request(argv)

	if (request === undefined || !(await try_record_plan(request))) return FAILURE_EXIT_CODE

	return await lane_plan_code(request)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_plan_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_plan_cli }
