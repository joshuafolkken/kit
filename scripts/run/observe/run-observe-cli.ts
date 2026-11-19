#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_observe, type ObservePlan } from './run-observe'
import { run_observe_state } from './run-observe-state'

// joshuafolkken/kit#8128: `josh run:observe` — the argument side of `run-observe.ts`.

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const COMMAND_SEPARATOR = '--'
const USAGE = [
	'Usage: josh run:observe start <issue> --at <offset>... --sample "<command>" -- <command...>',
	'       josh run:observe sample <issue>',
].join('\n')
const OPTIONS = {
	at: { type: 'string', multiple: true },
	sample: { type: 'string' },
} as const

type Request =
	{ action: 'start'; issue: string; plan: ObservePlan } | { action: 'sample'; issue: string }

// Every offset as milliseconds, ascending, or `undefined` when one does not parse or none is given.
function offsets_of(texts: ReadonlyArray<string> = []): ReadonlyArray<number> | undefined {
	const offsets = texts.map((text) => run_observe_state.offset_ms(text))

	if (offsets.length === 0 || offsets.includes(undefined)) return undefined

	return offsets.map(Number).toSorted((left, right) => left - right)
}

function complete_plan(
	offsets_ms: ReadonlyArray<number> | undefined,
	sample: string,
	command: ReadonlyArray<string>,
): ObservePlan | undefined {
	const [program, ...rest] = command

	return offsets_ms === undefined || sample === '' || program === undefined
		? undefined
		: { command: [program, ...rest], sample, offsets_ms }
}

function plan_of(
	flags: ReadonlyArray<string>,
	command: ReadonlyArray<string>,
): ObservePlan | undefined {
	const parsed = cli_flags.arguments_of(flags, OPTIONS)

	if (parsed === undefined) return undefined

	return complete_plan(offsets_of(parsed.values.at), parsed.values.sample ?? '', command)
}

function start_request(issue: string, rest: ReadonlyArray<string>): Request | undefined {
	const separator = rest.indexOf(COMMAND_SEPARATOR)

	if (separator === -1) return undefined

	const plan = plan_of(rest.slice(0, separator), rest.slice(separator + 1))

	return plan === undefined ? undefined : { action: 'start', issue, plan }
}

function sample_request(
	action: string | undefined,
	issue: string,
	rest: ReadonlyArray<string>,
): Request | undefined {
	return action === 'sample' && rest.length === 0 ? { action, issue } : undefined
}

function request_of(argv: ReadonlyArray<string>): Request | undefined {
	const [action, issue, ...rest] = argv

	if (issue === undefined || !issue_number_shape.is_issue_number(issue)) return undefined

	return action === 'start' ? start_request(issue, rest) : sample_request(action, issue, rest)
}

async function answer(request: Request): Promise<string> {
	const deps = run_observe.SYSTEM_DEPS

	if (request.action === 'sample') return await run_observe.sample(request.issue, deps)

	return await run_observe.start(request.issue, request.plan, deps)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = request_of(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	try {
		console.info(await answer(request))

		return 0
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))

		return FAILURE_EXIT_CODE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_observe_cli = { request_of, run, USAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_observe_cli }
