#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { path_decision } from '#scripts/josh/path-decision'
import { managed_config_scope } from './managed-config-scope'

// `josh sync:scope` — say whether this change touches a file `josh sync` distributes
// (joshuafolkken/kit#1578).
//
// A command rather than a paragraph, for the reason `josh review:level` is one: the confirmation
// stop this feeds was written as an instruction to compare the diff against three arrays by eye, and
// on the day it was measured two runs in three did not make the comparison at all. `AI_COPY_DIRECTORIES`
// is why an eye comparison cannot be relied on even when it is made — a distributed path need not
// appear in any list textually, so the reader is solving a prefix match by hand.
//
// Everything but the question itself — reading the changed paths, the flags, the printing — is
// `path_decision`'s, shared with `josh review:level` and `josh eval:scope`, which ask different
// questions of the same tree.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh sync:scope [--staged] [--json]'
const JSON_KEY = 'scope'

const MANAGED_ANSWER = 'managed'
const CLEAN_ANSWER = 'clean'

type SyncScope = typeof MANAGED_ANSWER | typeof CLEAN_ANSWER

function decide(paths: ReadonlyArray<string>): SyncScope {
	return managed_config_scope.has_managed_path(paths) ? MANAGED_ANSWER : CLEAN_ANSWER
}

// The reason names the list beside each path, because that is the half a reader cannot derive: a
// path claimed by `AI_COPY_DIRECTORIES` matches no entry textually. The truncation is
// `path_decision`'s own, so a large diff prints a reason rather than a wall.
function format_reason(paths: ReadonlyArray<string>, answer: SyncScope): string {
	if (answer === CLEAN_ANSWER) return 'no changed path is distributed by josh sync'

	const hits = managed_config_scope.find_managed_paths(paths)
	const listed = hits.map((hit) => managed_config_scope.format_hit(hit))

	return `distributed paths in this change: ${path_decision.format_path_list(listed)}`
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	return await path_decision.run_path_decision(argv, {
		usage: USAGE,
		key: JSON_KEY,
		decide,
		explain: format_reason,
	})
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const managed_config_scope_cli = { decide, format_reason, JSON_KEY, main, run, USAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

// The two answers are named exports rather than members of the object above: read off a plain object
// literal they widen to `string`, and a caller comparing against them then type-checks against any
// string at all. Constants are exempt from the namespace grouping convention for this reason.
export { managed_config_scope_cli, MANAGED_ANSWER, CLEAN_ANSWER }
export type { SyncScope }
