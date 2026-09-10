#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { git_command } from './git-command'

// `josh main:sync` (`josh ms`) — return this checkout to the default branch and pull
// (joshuafolkken/kit#1535).
//
// **It refuses inside a linked work tree, and that refusal is the reason this stopped being a
// one-line `sh -c` entry.** The default branch is a *branch*: advancing it means checking it out
// somewhere, and git allows one branch in one work tree at a time. Run from a lane, `git checkout
// <default>` therefore does two things nobody asked for — measured on 2026-09-07 while five lanes
// were open:
//
// 1. **The lane stops being a lane.** `lane:list` matches on the branch name, so the work tree drops
//    out of the listing, `lane:close` can no longer reach it, and the port seat its `.env` holds is
//    never reclaimed.
// 2. **Every other lane's `josh ms` then fails**, with `fatal: '<default>' is already used by
//    worktree at '<the hijacked lane>'` — one lane's tidy-up step breaks the other four.
//
// A lane's terminal step is `pnpm josh lane:close <issue-number>`; the refusal says so. Nothing about
// the main work tree's behavior changes.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const COMMAND_NAME = 'main:sync'

// `git_directories()` returns `[--absolute-git-dir, --git-common-dir]`. They are the same path in the
// main work tree and differ in a linked one, which is git's own definition of the distinction rather
// than a guess from a directory name.
const OWN_GIT_DIRECTORY = 0
const COMMON_GIT_DIRECTORY = 1

// The refusal covers every linked work tree, not lanes alone, because the hijack is a property of
// the work tree rather than of what opened it. It names both ways out for that reason.
const LANE_REFUSAL = [
	`josh ${COMMAND_NAME} cannot run inside a linked work tree.`,
	'Checking the default branch out here takes it from whichever work tree holds it, and a lane that loses its own branch drops out of `josh lane:list` with its port seat still allocated.',
	'Run `pnpm josh ms` in the primary checkout instead; a lane is finished with `pnpm josh lane:close <issue-number>`.',
].join('\n')

async function is_linked_work_tree(): Promise<boolean> {
	const directories = await git_command.git_directories()

	return directories[OWN_GIT_DIRECTORY] !== directories[COMMON_GIT_DIRECTORY]
}

async function synchronize(): Promise<number> {
	const default_branch = await git_command.get_default_branch()

	await git_command.checkout(default_branch)
	await git_command.pull_fast_forward()
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

	if (await is_linked_work_tree()) {
		console.error(LANE_REFUSAL)

		return FAILURE_EXIT_CODE
	}

	return await synchronize()
}

// A git failure — a dirty tree the checkout refuses to leave, a pull that cannot reach the remote —
// is reported as a message rather than a stack trace, matching every other josh CLI.
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

const main_sync = { COMMAND_NAME, LANE_REFUSAL, main, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { main_sync }
