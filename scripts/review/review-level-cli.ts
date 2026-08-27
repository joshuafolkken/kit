#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { path_decision } from '#scripts/josh/path-decision'
import { review_level, type ReviewLevel } from './review-level'

// `josh review:level` — print the `/code-review` level this change is reviewed at
// (joshuafolkken/kit#966).
//
// A command rather than a paragraph, because the point of the rule is that it takes no judgement.
// A rule an agent applies from memory is a rule an agent can talk itself out of; one it has to run
// answers the same way every time.
//
// Everything but the question itself — reading the changed paths, the flags, the printing — is
// `path_decision`'s, shared with `josh eval:scope`, which asks a different question of the same tree
// (joshuafolkken/kit#907).

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh review:level [--staged] [--json]'
const JSON_KEY = 'level'

function format_reason(paths: ReadonlyArray<string>, level: ReviewLevel): string {
	if (level === review_level.REDUCED_LEVEL) {
		return 'every changed path is inert — it neither executes nor instructs'
	}

	const deciding = review_level.deciding_paths(paths)

	if (deciding.length === 0) return 'no changed paths; the default level stands'

	return `changed paths that execute or instruct: ${path_decision.format_path_list(deciding)}`
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	return await path_decision.run_path_decision(argv, {
		usage: USAGE,
		key: JSON_KEY,
		decide: (paths) => review_level.level_for(paths),
		explain: format_reason,
	})
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const review_level_cli = { format_reason, JSON_KEY, main, run, USAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { review_level_cli }
