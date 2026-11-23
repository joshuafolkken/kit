#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { derived_paths } from '#scripts/split/derived-paths'
import type { LanePlan } from './lane-plan'
import { lane_plan_approval } from './lane-plan-approval'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_estimate } from './lane-plan-estimate'
import { lane_plan_imports } from './lane-plan-imports'

// `josh lane:plan <issue> <path>... [--probe] [--imports <path>...]` — the command line over
// `lane-plan-check.ts`, which holds the check and the yield so `run:entry` can import them without this
// entry's main guard; `--imports` probes the modules the new code imports (`lane-plan-imports.ts`);
// `--single "<reason>"` declares the plan one deliverable, past the files axis (`lane-plan-size.ts`), and
// says why it cannot be merged in parts — a bare `--single` is refused (joshuafolkken/kit#7729).

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const PROBE_FLAG = '--probe'
const SINGLE_FLAG = '--single'
const FLAG_PREFIX = '--'
const PATH_SEPARATOR = '/'
const WORD_SEPARATOR = ' '
const FLAG_WIDTH = 1
const FLAG_WITH_VALUE_WIDTH = 2
const USAGE =
	'Usage: josh lane:plan <issue-number> <path> [<path> ...] [--probe] [--single "<reason>"] [--estimate <json-file>] [--size-approval <json-file>] [--imports <path> ...]'
const { YIELD_EXIT_CODE } = lane_plan_check

interface Single {
	tokens: ReadonlyArray<string>
	// `undefined` with no `--single`; empty when `--single` names no reason.
	reason: string | undefined
}

// A flag or a path after `--single` names no reason: a path is one word holding a `/`, so it is refused,
// not taken out of the plan as the reason.
function is_reason(token: string): boolean {
	const is_path = token.includes(PATH_SEPARATOR) && !token.includes(WORD_SEPARATOR)

	return !token.startsWith(FLAG_PREFIX) && !is_path
}

function single_of(argv: ReadonlyArray<string>): Single {
	const at = argv.indexOf(SINGLE_FLAG)
	if (at === -1) return { tokens: argv, reason: undefined }
	const next = argv[at + 1] ?? ''
	const reason = is_reason(next) ? next.trim() : ''
	const width = reason === '' ? FLAG_WIDTH : FLAG_WITH_VALUE_WIDTH

	return { tokens: argv.toSpliced(at, width), reason }
}

async function planned(
	tokens: ReadonlyArray<string>,
	directory: string,
	reason: string | undefined,
): Promise<LanePlan | undefined> {
	const estimate = lane_plan_estimate.split(tokens)
	const input = lane_plan_approval.split(estimate.tokens)
	const plan = lane_plan_check.plan_of(input.tokens, new Date())
	if (plan === undefined) return undefined
	const declared = reason === undefined ? plan : { ...plan, single: true, single_reason: reason }

	const scoped = await lane_plan_estimate.attach(declared, estimate.file)

	return await lane_plan_approval.attach(lane_plan_check.placed(scoped, directory), input.file)
}

// The files the plan's sources derive, which the size estimate counts (`derived-paths.ts`, #8859), then
// the imports' probe.
function report(plan: LanePlan, imports: ReadonlyArray<string>, directory: string): void {
	const derived = derived_paths.of(plan.paths, derived_paths.read_in(directory))

	if (derived.length > 0) console.info(`derived (counted in the size): ${derived.join(' ')}`)
	lane_plan_imports.report(String(plan.issue), imports, directory)
}

async function run(
	argv: ReadonlyArray<string>,
	directory: string = process.cwd(),
): Promise<number> {
	const single = single_of(argv.filter((token) => token !== PROBE_FLAG))
	const { plan: tokens, imports } = lane_plan_imports.split(single.tokens)
	const plan = single.reason === '' ? undefined : await planned(tokens, directory, single.reason)

	if (plan === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const action = argv.includes(PROBE_FLAG)
		? lane_plan_check.probe_answer
		: lane_plan_check.check_plan
	const code = await action(plan, directory)

	report(plan, imports, directory)

	return code
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_plan_cli = { USAGE, YIELD_EXIT_CODE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_plan_cli }
