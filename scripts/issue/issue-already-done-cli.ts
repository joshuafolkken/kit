#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_evidence_exit } from '#scripts/issue/issue-evidence-exit'
import { ALREADY_DONE_LABEL } from '#scripts/issue/issue-labels'

// `josh issue:already-done <N> --evidence-file <path>` — the exit for an Issue whose work is already
// merged (`issue-comments.md` → "When the work turns out to be already merged"): the evidence
// comment, the `already-done` label and the `run:release`, in that order (`issue-evidence-exit.ts`).
//
// The label is provisioned by `josh start`, so nothing here creates it.
// **The Issue is never closed**: closing is a person's (Tier C), and the label is the run's exit.

const ARGV_OFFSET = 2

async function apply_label(issue_number: string): Promise<boolean> {
	const write = await git_gh_command.issue_apply_label(issue_number, ALREADY_DONE_LABEL)

	if (!write.is_applied) console.error(`${ALREADY_DONE_LABEL} not applied: ${write.reason}`)

	return write.is_applied
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	return await issue_evidence_exit.run(argv, { command: 'issue:already-done', finish: apply_label })
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_already_done_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_already_done_cli }
