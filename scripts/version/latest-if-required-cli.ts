#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_stash } from '#scripts/git/stash/git-stash'
import { stash_pop_cli } from '#scripts/git/stash/stash-pop-cli'
import { stash_push_cli } from '#scripts/git/stash/stash-push-cli'
import { resolve_spawn_exit } from '#scripts/lib/spawn-exit'
import { execaSync } from 'execa'
import { latest_scope_cli } from './latest-scope-cli'

// `josh latest:if-required` — the dependency update a run owes, in one call.
//
// `latest:scope` decides; on `required` the tree is set aside, `josh latest` runs, and the stash is
// popped by its message. Four procedures used to spell that sequence out, and each copy was one more
// place to drift from the others. `josh latest` itself stays a fixed `sh -c` chain that takes no
// arguments, so the conditional form is its own command rather than a flag on it.
//
// **Every failure leaves the stash where it is.** A failed update can leave `package.json` half
// rewritten, and a conflicted pop is a stash git keeps — popping onto either would bury the work
// under conflicts, so the command stops with the message to pop it by.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh latest:if-required'
const STASH_MESSAGE = 'josh latest'
const LATEST_COMMAND: ReadonlyArray<string> = ['josh', 'latest']
const PNPM = 'pnpm'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const KEPT_STASH_HINT = `the stash is kept — pop it with \`pnpm josh stash:pop "${STASH_MESSAGE}"\``
// A conflicted pop has already applied the stash, so popping it again would apply it twice.
const CONFLICTED_STASH_HINT = `the stash "${STASH_MESSAGE}" is applied and still kept — resolve the conflicts, then drop it`

function run_latest(): number {
	const result = execaSync(PNPM, LATEST_COMMAND, { stdio: 'inherit', reject: false })

	return resolve_spawn_exit(PNPM, result)
}

function stop(reason: string): number {
	console.error(`latest:if-required stopped: ${reason}`)

	return FAILURE_EXIT_CODE
}

function refuse(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function restore(): Promise<number> {
	const code = await stash_pop_cli.run([STASH_MESSAGE])

	if (code !== SUCCESS_EXIT_CODE) return stop(`the pop failed — ${KEPT_STASH_HINT}`)
	if (await git_stash.has_conflict()) return stop(`the pop conflicted — ${CONFLICTED_STASH_HINT}`)

	return SUCCESS_EXIT_CODE
}

async function update(): Promise<number> {
	const verdict = await stash_push_cli.set_aside({ message: STASH_MESSAGE, dir: undefined })
	const is_stashed = verdict === stash_push_cli.STASHED_VERDICT
	const code = run_latest()

	if (code !== SUCCESS_EXIT_CODE) {
		return stop(is_stashed ? `josh latest failed — ${KEPT_STASH_HINT}` : 'josh latest failed')
	}

	return is_stashed ? await restore() : SUCCESS_EXIT_CODE
}

// The scope on stdout and its reason on stderr, the split `latest:scope` prints in, so the log
// says why the update ran or did not.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) return refuse()

	const decision = latest_scope_cli.scope_decision()

	console.info(decision.scope)
	console.error(decision.reason)
	if (decision.scope === latest_scope_cli.SKIPPED_SCOPE) return SUCCESS_EXIT_CODE

	return await update()
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const latest_if_required_cli = { run, STASH_MESSAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { latest_if_required_cli }
