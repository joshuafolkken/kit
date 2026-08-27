#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { path_decision } from '#scripts/josh/path-decision'
import { eval_trigger, type EvalScope } from './eval-trigger'

// `josh eval:scope` — say whether this change has to be measured by `josh eval`
// (joshuafolkken/kit#907).
//
// A command rather than a paragraph in `docs/eval.md`, for the reason `josh review:level` is one: a
// rule an agent applies from memory is a rule an agent can talk itself out of, and this one is
// argued against every time it is reached, because the run it asks for costs real Claude sessions.
//
// Everything but the question itself — reading the changed paths, the flags, the printing — is
// `path_decision`'s, shared with `josh review:level`.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh eval:scope [--staged] [--json]'
const JSON_KEY = 'scope'

function format_reason(paths: ReadonlyArray<string>, scope: EvalScope): string {
	if (scope === eval_trigger.SKIPPED_SCOPE) {
		return 'no changed path is one the scenarios can see — nothing to measure'
	}

	const deciding = eval_trigger.deciding_paths(paths)

	if (deciding.length === 0) {
		return 'no changed paths were read; the suite runs rather than assuming there was nothing to measure'
	}

	return `changed paths the scenarios read: ${path_decision.format_path_list(deciding)}`
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	return await path_decision.run_path_decision(argv, {
		usage: USAGE,
		key: JSON_KEY,
		decide: (paths) => eval_trigger.scope_for(paths),
		explain: format_reason,
	})
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const eval_trigger_cli = { format_reason, JSON_KEY, main, run, USAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { eval_trigger_cli }
