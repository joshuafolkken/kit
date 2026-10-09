#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { extract_issue_number } from '#scripts/hooks/check-commit-message'
import { issue_cite } from '#scripts/issue/issue-cite'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { error_text } from '#scripts/lib/error-message'
import { git_command } from './git-command'
import { main_merge_guard } from './main-merge-guard'
import { merge_drivers } from './merge-drivers'

// `josh main:merge` (`josh mm`) — bring the default branch into the branch this checkout is on.
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
// rather than rebasing because a rebase rewrites
// commits that are already pushed, so it needs a force push, which `.claude/settings.json` denies.
//
// `git_command.merge_fast_forward` is deliberately not reused: it passes `--ff-only`, which fails
// loudly on exactly the divergence this command has to absorb.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const COMMAND_NAME = 'main:merge'

// git's default merge message carries no `#N`, so on an issue branch the `commit-msg` hook refuses
// it and leaves the index mid-merge. The number is read with the hook's
// own parser, so the message this writes is exactly the one that hook accepts; a branch without a
// number keeps git's default.
function merge_message(default_branch: string, current_branch: string): string | undefined {
	const issue_number = extract_issue_number(current_branch)

	if (issue_number === undefined) return undefined

	return `Merge ${default_branch} into ${current_branch} ${issue_cite.plain(issue_number)}`
}

// What one merge of the default branch came to. `josh ship` merges it again
// before the commit and on a conflicting pull request, and branches on the answer rather than on an
// exit code: `current` brought nothing in, so the tree is unchanged; `merged` changed it; `refused`
// is the guard's answer, nothing attempted; `conflict` names the paths git left unmerged, so a resumed
// session goes straight to them instead of asking git again.
type MergeOutcome =
	| { kind: 'current'; branch: string }
	| { kind: 'merged'; branch: string }
	| { kind: 'refused'; message: string }
	| { kind: 'conflict'; files: ReadonlyArray<string> }

interface MergeTarget {
	default_branch: string
	current_branch: string
	is_current: boolean
}

// A failure that left no unmerged path — a remote that cannot be reached, a hook that refused — is not
// a conflict, so it is rethrown rather than reported as one with nothing to resolve.
async function merge_into(target: MergeTarget): Promise<MergeOutcome> {
	const { default_branch, current_branch } = target

	try {
		await git_command.merge_branch(
			default_branch,
			merge_message(default_branch, current_branch),
			merge_drivers.git_options(),
		)
	} catch (error) {
		const files = main_merge_guard.unmerged_paths(await git_command.status())

		if (files.length === 0) throw error

		return { kind: 'conflict', files }
	}

	return { kind: target.is_current ? 'current' : 'merged', branch: default_branch }
}

// The fetch is what makes `origin/<default>` current before the merge reads it. `git pull` did the
// two together, which is the only thing it was doing here that is worth keeping. The refusal is read
// after the fetch, so the incoming paths are the ones the merge would bring in.
async function merge(): Promise<MergeOutcome> {
	const default_branch = await git_command.get_default_branch()
	const current_branch = await git_command.branch()

	await git_command.fetch_branch(default_branch)

	const status = await git_command.status()
	const incoming = await main_merge_guard.incoming_paths(default_branch)
	const message = main_merge_guard.refusal(status, incoming, default_branch)

	if (message !== undefined) return { kind: 'refused', message }

	return await merge_into({ default_branch, current_branch, is_current: incoming.length === 0 })
}

// A merge that stops on a conflict keeps git's report and adds how to finish it, so the next step is
// the sanctioned commit rather than a request for `git add`.
function failure_text(outcome: MergeOutcome): string | undefined {
	if (outcome.kind === 'refused') return outcome.message
	if (outcome.kind === 'conflict') return main_merge_guard.CONFLICT_HINT

	return undefined
}

async function merge_default_branch(): Promise<number> {
	const outcome = await merge()
	const failure = failure_text(outcome)

	if (failure !== undefined) {
		console.error(failure)

		return FAILURE_EXIT_CODE
	}

	if ('branch' in outcome) console.info(outcome.branch)

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
		console.error(error_text.message_of(error))

		return FAILURE_EXIT_CODE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const main_merge = { merge, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { main_merge }
export type { MergeOutcome }
