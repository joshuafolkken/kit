#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_followup_pending } from '#scripts/git/git-followup-pending'
import { path_decision } from '#scripts/josh/path-decision'
import { release_plan } from './release-plan'

// **Whether a release is owed is a command's answer, not a judgement** (joshuafolkken/kit#1582).
//
// joshuafolkken/kit#1169 took the version off the branch and put it behind one command a person
// types, and nothing ever said *when* to type it. Nothing fails when nobody does — CI green, every
// pull request merged, every Issue closed — so 53 merges reached main unreleased and no consumer of
// this package saw one of them.
//
// **`pnpm josh release --dry-run` cannot be the check.** It refuses off the default branch and on a
// dirty working tree, and it counts against `HEAD`; every position a run asks the question from is
// a feature branch or a lane, which is exactly where it throws.
//
// **So this counts nothing of its own.** It reads the number `pnpm josh followup` already puts in
// the completion notification — `git_followup_pending.read_pending`, which fetches the default
// branch and counts `--first-parent` merges against `origin/<default>` — and turns it into a
// verdict. One counting path, two readers.
//
// The flag parse and the printing come from `path_decision`, the contract every mechanically-decided
// command here shares. Only its `parse_options` / `run_path_decision` are path-specific, and this
// decision is not made from changed paths, so those two are the ones left alone.
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh release:scope [--json]'
const JSON_KEY = 'scope'
// Not `path_decision.KNOWN_FLAGS`: that set carries `--staged`, which means nothing here, and a
// command that accepts a flag it ignores answers a question nobody asked.
const KNOWN_FLAGS: ReadonlyArray<string> = [path_decision.JSON_FLAG]
const REQUIRED_SCOPE = 'required'
const SKIPPED_SCOPE = 'skip'
const UNKNOWN_SCOPE = 'unknown'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NOTHING_PENDING_REASON = 'main has taken no merge since the version last changed'
const RELEASE_HINT = 'run `pnpm josh release` on the default branch of the primary checkout'
// **Not `skip`.** An unreadable version, a fetch that could not run or a base the search cannot
// resolve is not "nothing is waiting to ship", and reporting it as one is how a release goes
// missing quietly a second time.
const UNKNOWN_REASON = 'the unreleased-merge count could not be read — report unknown, never skip'

type ReleaseScope = typeof REQUIRED_SCOPE | typeof SKIPPED_SCOPE | typeof UNKNOWN_SCOPE

interface Decision {
	scope: ReleaseScope
	reason: string
}

// **The threshold is one, and the position carries the rest.** A release per invocation is the
// cadence joshuafolkken/kit#1582 asks for — its own complaint is that accumulating makes a single
// version larger and its contents harder to trace afterwards — so anything above zero is owed. What
// keeps this from firing per child of a batch is where the question is asked, which belongs to the
// procedure rather than to this command.
function decide(pending: number | undefined): Decision {
	if (pending === undefined) return { scope: UNKNOWN_SCOPE, reason: UNKNOWN_REASON }

	const line = release_plan.format_pending_line(pending)

	if (pending === 0) return { scope: SKIPPED_SCOPE, reason: `${line} — ${NOTHING_PENDING_REASON}` }

	return { scope: REQUIRED_SCOPE, reason: `${line} — ${RELEASE_HINT}` }
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (path_decision.has_unknown_flag(argv, KNOWN_FLAGS)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const decision = decide(await git_followup_pending.read_pending({}))
	const is_json = argv.includes(path_decision.JSON_FLAG)

	path_decision.print_decision(JSON_KEY, decision.scope, decision.reason, is_json)

	return SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const release_scope_cli = {
	decide,
	main,
	run,
	JSON_KEY,
	KNOWN_FLAGS,
	NOTHING_PENDING_REASON,
	RELEASE_HINT,
	REQUIRED_SCOPE,
	SKIPPED_SCOPE,
	UNKNOWN_REASON,
	UNKNOWN_SCOPE,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { Decision, ReleaseScope }
export { release_scope_cli }
