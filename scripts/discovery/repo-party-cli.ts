#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { repo_party, type Party } from './repo-party'

// `josh repo:party [<owner/repo>]` — say whether a repository is first-party or third-party
// (joshuafolkken/kit#2122). A command rather than a paragraph, for the reason `josh latest:scope` is
// one: a rule an agent applies from memory is a rule an agent can talk itself out of, and this one is
// argued against at exactly the moment a workflow wants to write to another repository.
//
// The word alone on stdout so `$(pnpm josh repo:party o/r)` reads it, and the two owners it compared
// on stderr so a person sees why without a shell having to parse around it — the split
// `josh latest:scope` prints in.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh repo:party [<owner/repo>]'
const FAILURE_EXIT_CODE = 1
const FLAG_PREFIX = '-'
const NONE_ARGUMENT = 0
const ONE_ARGUMENT = 1
const UNREADABLE = '(unreadable)'

interface Decision {
	party: Party
	detail: string
}

function owner_label(owner: string | undefined): string {
	return owner ?? UNREADABLE
}

// No argument targets the session's own repository, so both owners are the session's and the answer
// is `first-party` unless the session's remote cannot be read. The stderr line names the two owners
// the classification actually compared, whichever arm was taken.
function decide(owner_repo: string | undefined): Decision {
	const session_owner = repo_party.current_owner()
	const target = owner_repo === undefined ? session_owner : repo_party.target_owner(owner_repo)

	return {
		party: repo_party.classify(session_owner, target),
		detail: `session owner: ${owner_label(session_owner)} · target owner: ${owner_label(target)}`,
	}
}

function run(argv: ReadonlyArray<string>): number {
	const positional = argv.filter((argument) => !argument.startsWith(FLAG_PREFIX))

	if (positional.length !== NONE_ARGUMENT && positional.length !== ONE_ARGUMENT) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const decision = decide(positional[0])

	console.info(decision.party)
	console.error(decision.detail)

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const repo_party_cli = { USAGE, decide, main, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { repo_party_cli }
