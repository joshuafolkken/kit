#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { epic_close } from '#scripts/epic/epic-close'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_pr_read } from '#scripts/gh/git-gh-pr-read'
import { git_command } from '#scripts/git/git-command'
import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { issue_evidence_exit } from '#scripts/issue/issue-evidence-exit'
import { measure_declaration } from '#scripts/issue/measure-declaration'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_paths } from '#scripts/lane/lane-paths'
import { lane_registry } from '#scripts/lane/lane-registry'
import { error_text } from '#scripts/lib/error-message'

// `josh issue:premise-unmet <N> --evidence-file <path>` — the exit for an Issue whose body declares
// when to close it unimplemented (the `close_condition` line under the background heading) once that condition holds
// (`issue-comments.md` → "When a declared close condition holds"): the verdict comment, the
// `not_planned` close, and the `run:release`, in that order (`issue-evidence-exit.ts`).
//
// **It closes only what loses nothing** (joshuafolkken/kit#7286): the body declares the condition, so
// the close is the filer's decision, not the lane's; the lane branch carries no commit beyond
// `origin/main` and no uncommitted change, and has no pull request. Any of those missing or unreadable
// refuses with nothing written — a lane that only judges the work not worth doing still parks. A
// reopen undoes the close and the comment records why, so it is Tier A. The lane itself is cleared by
// the wake loop's sweep of not-planned closes (`lane-withdraw-closed.ts`), not here.

const ARGV_OFFSET = 2
const COMMAND = 'issue:premise-unmet'
const BASE = 'origin/main'

function is_declared(body: string): boolean {
	return issue_body_keys
		.prefix_variants('close_condition')
		.some((prefix) => (measure_declaration.background_value(body, prefix) ?? '').length > 0)
}

async function declaration_refusal(issue_number: string): Promise<string | undefined> {
	const body = await git_gh_command.issue_get_body(issue_number)
	if (body === undefined) return 'its body was not read'
	if (is_declared(body)) return undefined

	return `its body declares no \`${issue_body_keys.prefix('close_condition')}\` line under \`${issue_body_keys.heading('background')}\``
}

async function lane_directory(issue_number: string): Promise<string> {
	return lane_paths.lane_directory(await lane_registry.lane_root_directory(), issue_number)
}

async function branch_refusal(issue_number: string): Promise<string | undefined> {
	const branch = lane_paths.lane_branch(issue_number)

	if ((await git_command.commit_count_beyond(BASE, branch)) > 0) {
		return `\`${branch}\` has commits beyond \`${BASE}\``
	}

	const status = await git_command.status(await lane_directory(issue_number))
	if (status.trim().length > 0) return `the lane work tree has uncommitted changes`
	if (await git_gh_pr_read.pr_exists(branch)) return `\`${branch}\` has a pull request`

	return undefined
}

// A read that fails refuses too: closing over a branch or pull request it could not see may drop work.
async function refusal_of(issue_number: string): Promise<string | undefined> {
	try {
		return (await declaration_refusal(issue_number)) ?? (await branch_refusal(issue_number))
	} catch (error) {
		return `its lane was not read (${error_text.message_of(error)})`
	}
}

async function admit(issue_number: string): Promise<boolean> {
	const refusal = await refusal_of(issue_number)
	if (refusal === undefined) return true
	console.error(
		`Issue ${session_cite.issue(issue_number)} not closed as not planned: ${refusal}; nothing written`,
	)

	return false
}

async function finish(issue_number: string): Promise<boolean> {
	const is_closed = await git_gh_command.issue_close(issue_number, undefined, 'not_planned')

	if (!is_closed) {
		console.error(
			`Issue ${session_cite.issue(issue_number)} left open: the not-planned close failed`,
		)

		return false
	}

	await epic_close.close_completed_epics({ issue_number, is_merged: true })

	return true
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	return await issue_evidence_exit.run(argv, { command: COMMAND, admit, finish })
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_premise_unmet_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_premise_unmet_cli }
