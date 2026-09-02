#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { path_decision } from '#scripts/josh/path-decision'
import { eval_stamp } from './eval-stamp'
import { eval_switch } from './eval-switch'
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
const USAGE = 'Usage: josh eval:scope [--staged | --since-eval] [--json]'
const JSON_KEY = 'scope'
const FAILURE_EXIT_CODE = 1

// The staleness half of the concurrent placement (joshuafolkken/kit#1152). `--since-eval` asks the
// command's own question — does this have to be measured — of a different set of changed paths: the
// ones the review touched while `josh eval` was already running.
const SINCE_EVAL_FLAG = '--since-eval'
const NO_STAMP_REASON =
	'no record of what a run measured, so a concurrent result has nothing vouching for it — measure rather than assume'
const UNREADABLE_TREE_REASON =
	'the measured paths could not be read, so nothing can be compared against the record — measure rather than assume'

interface Decision {
	scope: EvalScope
	reason: string
}

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

// The time is part of the sentence rather than an aside: `josh eval` rewrites the record when it
// starts, so a timestamp from another loop is how a reader sees that this answer is about a run
// they are not holding the verdict of.
function since_eval_reason(started_at: string, changed: ReadonlyArray<string>): string {
	if (changed.length === 0) {
		return `nothing the scenarios read has changed since the run started at ${started_at}`
	}

	return `changed since the run started at ${started_at}: ${path_decision.format_path_list(changed)}`
}

// Both ways of having no comparison to make — no record, or a tree that would not read — answer
// `required`. That is the same direction the branch reading takes its empty diff in: a caller that
// could not establish what changed is never handed the answer a caller that measured would get.
function since_eval_decision(): Decision {
	const stamp = eval_stamp.read_stamp()

	if (stamp === undefined) return { scope: eval_trigger.REQUIRED_SCOPE, reason: NO_STAMP_REASON }

	const tree = eval_stamp.try_read_tree()

	if (tree === undefined) {
		return { scope: eval_trigger.REQUIRED_SCOPE, reason: UNREADABLE_TREE_REASON }
	}

	const changed = eval_stamp.changed_since(stamp, tree)

	return {
		scope: eval_trigger.scope_for_measured_changes(changed),
		reason: since_eval_reason(stamp.started_at, changed),
	}
}

// The opt-in switch, applied at the one place both readings pass through (joshuafolkken/kit#1235).
// Both answer `skip` when the measurement is off, and both say so rather than borrowing the
// path-based sentence: `no changed path is one the scenarios can see` would describe a diff nobody
// looked at, and a reader chasing an unexpected `skip` needs the switch named to find it.
function disabled_decision(): Decision {
	return { scope: eval_trigger.SKIPPED_SCOPE, reason: eval_switch.DISABLED_REASON }
}

// The flags are still parsed and a bad one still fails: an invocation nobody can read must not be
// handed the same `skip` a correct one gets, whichever way the switch is set.
function decide_scope(paths: ReadonlyArray<string>): EvalScope {
	if (!eval_switch.is_enabled()) return eval_trigger.SKIPPED_SCOPE

	return eval_trigger.scope_for(paths)
}

function explain_scope(paths: ReadonlyArray<string>, scope: EvalScope): string {
	if (!eval_switch.is_enabled()) return eval_switch.DISABLED_REASON

	return format_reason(paths, scope)
}

// `--staged` alongside `--since-eval` would ask two different questions in one invocation — one of
// the index, one of a recorded run — so it is refused rather than resolved in the command's favour.
function run_since_eval(argv: ReadonlyArray<string>): number {
	const rest = argv.filter((argument) => argument !== SINCE_EVAL_FLAG)
	const options = path_decision.parse_options(rest)

	if (options === undefined || options.is_staged) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const { scope, reason } = eval_switch.is_enabled() ? since_eval_decision() : disabled_decision()

	path_decision.print_decision(JSON_KEY, scope, reason, options.is_json)

	return 0
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.includes(SINCE_EVAL_FLAG)) return run_since_eval(argv)

	return await path_decision.run_path_decision(argv, {
		usage: USAGE,
		key: JSON_KEY,
		decide: decide_scope,
		explain: explain_scope,
	})
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const eval_trigger_cli = {
	decide_scope,
	disabled_decision,
	explain_scope,
	format_reason,
	JSON_KEY,
	main,
	NO_STAMP_REASON,
	run,
	run_since_eval,
	since_eval_decision,
	since_eval_reason,
	SINCE_EVAL_FLAG,
	UNREADABLE_TREE_REASON,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { eval_trigger_cli }
