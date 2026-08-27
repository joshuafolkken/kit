#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { delegation_policy } from './delegation-policy'

// `josh delegate <step>` — may this step run in a cheaper execution tier? (joshuafolkken/kit#969)
//
// A command rather than a paragraph, for the reason `josh review:level` is one: a rule an agent
// applies from memory is a rule an agent can talk itself out of, and this is the rule that decides
// how carefully the next thing is done.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh delegate <step> | josh delegate --list'

function print_list(): number {
	console.info('delegatable:')

	for (const step of delegation_policy.DELEGATABLE_STEPS) {
		console.info(`  ${step.name}\n    does     ${step.does}\n    verified ${step.verifier}`)
	}

	console.info('\nkept (considered and rejected):')

	for (const step of delegation_policy.REJECTED_STEPS) {
		console.info(`  ${step.name}\n    because  ${step.because}`)
	}

	console.info('\nAnything not listed above is kept. The list is the whole of it.')

	return 0
}

const LIST_FLAG = '--list'
const FLAG_PREFIX = '-'

// A step name never starts with a dash, so anything that does is a flag — and the only flag this
// command has is `--list`. Without this, `josh delegate --help` answered `keep`: a mistyped
// invocation would read as a verdict about a step called `--help` (joshuafolkken/kit#969).
function is_unknown_flag(argument: string): boolean {
	// Trimmed, because the policy lookup trims too: without it `josh delegate ' --help'` slipped past
	// the guard and answered `keep` for a step called ` --help`.
	const trimmed = argument.trim()

	return trimmed.startsWith(FLAG_PREFIX) && trimmed !== LIST_FLAG
}

// Exactly one argument, non-empty, and either the one flag this command has or a step name.
function is_refused(argv: ReadonlyArray<string>): boolean {
	const [first, ...rest] = argv

	if (first === undefined || rest.length > 0) return true

	return first.trim() === '' || is_unknown_flag(first)
}

function run(argv: ReadonlyArray<string>): number {
	if (is_refused(argv)) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const [first = ''] = argv

	if (first === LIST_FLAG) return print_list()

	// The verdict alone on stdout so `$(josh delegate <step>)` reads it; the reason on stderr so a
	// person sees why without a shell having to parse around it.
	console.info(delegation_policy.verdict_for(first))
	console.error(delegation_policy.reason_for(first))

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const delegation_cli = { USAGE, print_list, run, main }

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { delegation_cli }
