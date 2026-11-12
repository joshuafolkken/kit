#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { PORCELAIN_FLAG, UNTRACKED_FILES_FLAG } from '#scripts/git/constants'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { git_stash } from '#scripts/git/stash/git-stash'
import { session_cite } from '#scripts/issue/session-cite'
import { run_hold, type HoldRead, type RunHold } from '#scripts/run/hold/run-hold'
import { tree_status, type TreeParts } from './tree-status'

// `josh tree:status` — one call for the pre-check a session runs before acting on the working tree:
// the branch, `git status`, `git stash list` and this tree's run hold.
//
// **Nothing here writes.** The hold is read with `run_hold.read_hold`, never claimed, and the stash
// is listed, never pushed or popped — the read-only pin in `tree-status-cli.test.ts` catches a write.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh tree:status'
const LINE_SEPARATOR = '\n'
const BRANCH_FLAG = '--branch'
// Keeps git status from writing its refreshed stat cache back to the index.
const NO_OPTIONAL_LOCKS_FLAG = '--no-optional-locks'
const BRANCH_LINE_PREFIX = '## '
const UNKNOWN_HOLD = 'unknown'
const FREE_NOTE = 'no run holds this working tree'
const STALE_NEXT = 'It is still recorded; the next `run:hold` replaces it once the tree is clean.'
const FAILED_HOLDS: ReadonlySet<string> = new Set(['unreadable', UNKNOWN_HOLD])

interface TreeReads {
	branch: string
	status: string
	stashes: ReadonlyArray<string>
	// `undefined` when this work tree's git directory could not be read.
	hold: HoldRead | undefined
}

// `--branch` adds the `## <branch>...<upstream>` line, so the report shows where the branch stands
// against its upstream; `change_count` leaves that line out.
async function read_status(): Promise<string> {
	return await git_spawn.read([
		NO_OPTIONAL_LOCKS_FLAG,
		'status',
		PORCELAIN_FLAG,
		BRANCH_FLAG,
		UNTRACKED_FILES_FLAG,
	])
}

async function read_stashes(): Promise<ReadonlyArray<string>> {
	const entries = await git_stash.list()

	return entries.map((entry) => `${entry.selector} ${entry.subject}`)
}

async function read_tree_hold(): Promise<HoldRead | undefined> {
	const directory = await run_hold.worktree_directory()

	if (directory === undefined) return undefined

	return run_hold.read_hold(run_hold.hold_path(directory))
}

async function gather(): Promise<TreeReads> {
	const [branch, status, stashes, hold] = await Promise.all([
		git_command.branch(),
		read_status(),
		read_stashes(),
		read_tree_hold(),
	])

	return { branch, status, stashes, hold }
}

function change_count(status: string): number {
	return status
		.split(LINE_SEPARATOR)
		.filter((line) => line !== '' && !line.startsWith(BRANCH_LINE_PREFIX)).length
}

// The record is still on disk: the claim's own message narrates its replacement, which this read
// never performs.
function stale_note(hold: RunHold): string {
	return `Stale run record held by ${run_hold.describe_holder(hold)}: ${run_hold.stale_reason(hold)}. ${STALE_NEXT}`
}

function hold_detail(hold: HoldRead | undefined): string {
	if (hold === undefined) return run_hold.unknown_message()
	if (hold.kind === 'free') return FREE_NOTE
	if (hold.kind === 'unreadable') return run_hold.unreadable_message()

	return hold.kind === 'stale' ? stale_note(hold.hold) : run_hold.describe_holder(hold.hold)
}

function to_parts(reads: TreeReads): TreeParts {
	return {
		branch: reads.branch,
		status: reads.status,
		change_count: change_count(reads.status),
		stashes: reads.stashes,
		hold_summary: reads.hold?.kind ?? UNKNOWN_HOLD,
		hold_detail: hold_detail(reads.hold),
	}
}

// Non-zero when the hold could not be read: an unreadable record is not "nothing is running here",
// the distinction `run:hold` keeps. A git read that fails throws before any report is printed.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const parts = to_parts(await gather())

	console.info(session_cite.text(tree_status.format_report(parts)))

	return FAILED_HOLDS.has(parts.hold_summary) ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const tree_status_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { tree_status_cli }
