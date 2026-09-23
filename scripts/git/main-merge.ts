#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { extract_issue_number } from '#scripts/hooks/check-commit-message'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { git_command } from './git-command'

// `josh main:merge` (`josh mm`) — bring the default branch into the branch this checkout is on
// (joshuafolkken/kit#1659).
//
// **It stopped being a `git pull` because `git pull` cannot decide anything on a diverged branch.**
// With neither `pull.rebase` nor `pull.ff` set — the state of a checkout nobody has configured — git
// refuses the moment the two sides have each moved:
//
//     fatal: Need to specify how to reconcile divergent branches
//
// Divergence is not the edge case here; it is the entire reason to type this command. A lane whose
// branch has fallen behind `origin/<default>` has its own commits on it by definition, so **the one
// state the command exists for was the one state it could not run in.**
//
// The strategy is therefore named by this file rather than read out of whoever's git configuration
// happens to be in force: **fetch, then merge `origin/<default>` into the current branch.** Merging
// rather than rebasing is joshuafolkken/kit#1446's decision and not a fresh one — a rebase rewrites
// commits that are already pushed, so it needs a force push, which `.claude/settings.json` denies.
//
// `git_command.merge_fast_forward` is deliberately not reused: it passes `--ff-only`, which fails
// loudly on exactly the divergence this command has to absorb.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const COMMAND_NAME = 'main:merge'

// git's default merge message carries no `#N`, so on an issue branch the `commit-msg` hook refuses
// it and leaves the index mid-merge (joshuafolkken/kit#2439). The number is read with the hook's
// own parser, so the message this writes is exactly the one that hook accepts; a branch without a
// number keeps git's default.
function merge_message(default_branch: string, current_branch: string): string | undefined {
	const issue_number = extract_issue_number(current_branch)

	if (issue_number === undefined) return undefined

	return `Merge ${default_branch} into ${current_branch} #${issue_number}`
}

// The fetch is what makes `origin/<default>` current before the merge reads it. `git pull` did the
// two together, which is the only thing it was doing here that is worth keeping.
async function merge_default_branch(): Promise<number> {
	const default_branch = await git_command.get_default_branch()
	const current_branch = await git_command.branch()

	await git_command.fetch_branch(default_branch)
	await git_command.merge_branch(default_branch, merge_message(default_branch, current_branch))
	console.info(default_branch)

	return SUCCESS_EXIT_CODE
}

// The argument refusal is kept even though this is no longer an `sh -c` entry: the message is the
// same one every composite prints, and silently discarding a flag is what it exists to prevent.
async function dispatch(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		console.error(composite_arguments.format_rejection(COMMAND_NAME, []))

		return USAGE_ERROR_EXIT_CODE
	}

	return await merge_default_branch()
}

// A git failure — a merge conflict, a remote that cannot be reached — is reported as a message
// rather than a stack trace, matching every other josh CLI.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	try {
		return await dispatch(argv)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))

		return FAILURE_EXIT_CODE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const main_merge = { COMMAND_NAME, main, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { main_merge }
