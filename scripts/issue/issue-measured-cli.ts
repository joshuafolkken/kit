#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_evidence_exit } from '#scripts/issue/issue-evidence-exit'
import { MEASURED_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'

// `josh issue:measured <N> --evidence-file <path>` — the completion of a measurement-only Issue
// (`issue-comments.md` → "A measurement-only Issue"): the result comment, the
// `measured` label, the close and the `run:release`, in that order (`issue-evidence-exit.ts`).
//
// **The close is the run's own**: such an Issue changes no code, so no pull request's `closes #N`
// can close it, and an OPEN child `run:merge` reads as `failed` and parks with `run:stalled`. A
// CLOSED one it reads as `merged` (`run-merge.ts` → `classify_child`). The label goes on before the
// close because it is what every sweep — `run:carry --end`, `run:tidy` — tells this close from a
// person's by (`issue-merged.ts`); a close without it would be one they never count as merged.

const ARGV_OFFSET = 2

async function apply_label(issue_number: string): Promise<boolean> {
	const write = await git_gh_command.issue_apply_label(issue_number, MEASURED_LABEL)

	if (!write.is_applied) console.error(`${MEASURED_LABEL} not applied: ${write.reason}`)

	return write.is_applied
}

async function close_issue(issue_number: string): Promise<boolean> {
	const is_closed = await git_gh_command.issue_close(issue_number, undefined)

	if (!is_closed) console.error(`Issue ${session_cite.issue(issue_number)} not closed`)

	return is_closed
}

async function label_and_close(issue_number: string): Promise<boolean> {
	return (await apply_label(issue_number)) && (await close_issue(issue_number))
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	return await issue_evidence_exit.run(argv, { command: 'issue:measured', finish: label_and_close })
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_measured_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_measured_cli }
