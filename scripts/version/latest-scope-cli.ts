#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { latest_stamp, type LatestStamp } from './latest-stamp'

// `josh latest:scope` — say whether this run has to update dependencies (joshuafolkken/kit#1215).
//
// A command rather than a paragraph in a procedure, for the reason `josh review:level` and
// `josh eval:scope` are commands: a rule an agent applies from memory is a rule an agent can talk
// itself out of, and this one is argued against every time it is reached — once because the update
// costs a minute or two, and once because skipping it is invisible until something ships against a
// stale dependency.
//
// It does not share `path_decision` with those two: they decide from the *changed paths*, and this
// decides from *when the last run happened*. The flag parsing and the printing are the small half;
// the read of the diff is what that module exists for, and this command never makes one.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh latest:scope [--record] [--json]'
const JSON_KEY = 'scope'
const JSON_FLAG = '--json'
// Written by the `josh latest` chain itself once every step of it has succeeded, so a run that fell
// over halfway leaves no record and the next one updates again.
const RECORD_FLAG = '--record'
const KNOWN_FLAGS: ReadonlySet<string> = new Set([JSON_FLAG, RECORD_FLAG])
const REQUIRED_SCOPE = 'required'
const SKIPPED_SCOPE = 'skip'
const FAILURE_EXIT_CODE = 1
const NO_STAMP_REASON =
	'no record of a `josh latest` run in this checkout — update rather than assume the dependencies are current'
const HOURS_PRECISION = 1

type LatestScope = typeof REQUIRED_SCOPE | typeof SKIPPED_SCOPE

interface Decision {
	scope: LatestScope
	reason: string
}

function format_hours(hours: number): string {
	return hours.toFixed(HOURS_PRECISION)
}

// The age and the window both, because the answer is only readable beside the threshold that
// produced it — a bare "3.2 hours ago" says nothing about why that was enough.
function describe_stamp(stamp: LatestStamp, max_age_hours: number, is_fresh: boolean): string {
	const age = format_hours(latest_stamp.hours_since(stamp))
	const window = format_hours(max_age_hours)

	if (is_fresh) return `last run ${age}h ago, inside the ${window}h window — nothing to update`

	return `last run ${age}h ago, past the ${window}h window — update before implementing`
}

function decide(): Decision {
	const stamp = latest_stamp.read_stamp()

	if (stamp === undefined) return { scope: REQUIRED_SCOPE, reason: NO_STAMP_REASON }

	const max_age_hours = latest_stamp.read_max_age_hours()
	const is_fresh = latest_stamp.is_fresh(stamp, new Date(), max_age_hours)

	return {
		scope: is_fresh ? SKIPPED_SCOPE : REQUIRED_SCOPE,
		reason: describe_stamp(stamp, max_age_hours, is_fresh),
	}
}

// The answer alone on stdout so `$(pnpm josh latest:scope)` reads it, and the reason on stderr so a
// person sees why without a shell having to parse around it — the same split `josh review:level` and
// `josh eval:scope` print in.
function print_decision(decision: Decision, is_json: boolean): void {
	if (is_json) {
		console.info(JSON.stringify({ [JSON_KEY]: decision.scope, reason: decision.reason }))

		return
	}

	console.info(decision.scope)
	console.error(decision.reason)
}

// Nothing on stdout: `--record` is the write half, and a caller capturing `$(pnpm josh
// latest:scope)` must never be handed a scope by the invocation that was only meant to note a run
// down. The confirmation goes where the reasons go.
//
// **A write that failed is reported and exits zero.** This is the last link of the `josh latest`
// chain, so throwing here would turn a dependency update that fully succeeded into a red command
// with a stack trace — over a note nobody reads directly. A failed write leaves no record, and no
// record answers `required`, so the only consequence is that the next run updates again: the safe
// direction, and the one the write's own guards were built to fall in.
function record(): number {
	try {
		console.error(`recorded this josh latest run at ${latest_stamp.write_stamp()}`)
	} catch (error) {
		console.error(`could not record this josh latest run: ${String(error)}`)
	}

	return 0
}

function run(argv: ReadonlyArray<string>): number {
	if (argv.some((argument) => !KNOWN_FLAGS.has(argument))) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	if (argv.includes(RECORD_FLAG)) return record()

	print_decision(decide(), argv.includes(JSON_FLAG))

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const latest_scope_cli = {
	decide,
	describe_stamp,
	JSON_KEY,
	main,
	NO_STAMP_REASON,
	RECORD_FLAG,
	REQUIRED_SCOPE,
	run,
	SKIPPED_SCOPE,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export type { LatestScope }
export { latest_scope_cli }
