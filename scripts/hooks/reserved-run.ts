#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { command_memory } from '#scripts/gate/command-memory'
import { core_budget } from '#scripts/gate/core-budget'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { execa } from 'execa'

// Runs a command while holding a place in the machine-wide core budget.
//
// **The pre-push hook's `pnpm install` and `pnpm josh audit` are heavy and were outside the ledger.**
// The gate's checks reserve their cores, but a lefthook `pre-push` fires `pnpm install` on every push
// (`josh bump` rewrites `package.json` right before it) and runs `josh audit` beside it — and eight
// lanes reach that push around the same time, so the two spiked a machine the gate thought it had to
// itself. Wrapping each command here counts it: it claims a place before it starts and waits while the
// budget is full, exactly as a gate check does, so a concurrent gate on another lane backs off for it.
//
// **It is one wrapper for both rather than a reservation written into each command.** The audit scans
// synchronously and the install is pnpm's, so neither can hold an async reservation itself without
// being rewritten around it — and a second copy of the claim-run-release dance is the clone
// `CLAUDE.md` prohibits. The weight is the caller's, passed on the command line beside the command, so
// the reservation these two conservative numbers stand for lives at the one place a person reads them.
//
// **The memory is read off the command, not left at zero** (joshuafolkken/kit#4582): a lane wrapped a
// four-worker typed eslint here and the memory it held was admitted beside four other lanes. The
// wrapped command's tool and worker count give its `MEMORY_MB` (`command-memory.ts`); `--memory <MB>`
// overrides that estimate.

// `process.argv` is [runner, script, ...arguments].
const FIRST_ARGUMENT_INDEX = 2
// The token separating the reserved weight from the command it guards, so a command carrying flags of
// its own is never mistaken for this wrapper's arguments.
const COMMAND_SEPARATOR = '--'
const WEIGHT_INDEX = 0
const FAIL_EXIT_CODE = 1
// A reservation claims at least one core; a zero or negative weight would subtract from the ledger's
// cumulative sum and let a later reservation admit past the budget the ledger exists to hold.
const MIN_WEIGHT = 1

const MEMORY_FLAG = '--memory'
// `--memory <MB>`: the flag and its value.
const MEMORY_OPTION_LENGTH = 2
// An explicit `--memory` claims at least one MB; zero is the absence the estimate already stands for.
const MIN_MEMORY_MB = 1
// An argument that is one shell word with no quoting.
const PLAIN_WORD = /^[\w./=:@%+,-]+$/u
// A single quote inside a single-quoted word: close, escaped quote, reopen.
const ESCAPED_QUOTE = String.raw`'\''`

interface ReservedCommand {
	weight: number
	// The explicit `--memory <MB>`, which overrides the estimate read off the command.
	memory_mb: number | undefined
	command: ReadonlyArray<string>
}

function is_integer_from(value: number, floor: number): boolean {
	return Number.isSafeInteger(value) && value >= floor
}

// The options between the weight and the separator: none, or `--memory <MB>` with a positive integer.
// `undefined` is a usage error.
function parse_memory(
	options: ReadonlyArray<string>,
): { memory_mb: number | undefined } | undefined {
	if (options.length === 0) return { memory_mb: undefined }

	const memory_mb = Number(options[1])
	const is_memory_option = options.length === MEMORY_OPTION_LENGTH && options[0] === MEMORY_FLAG

	return is_memory_option && is_integer_from(memory_mb, MIN_MEMORY_MB) ? { memory_mb } : undefined
}

// `<weight> [--memory <MB>] -- <command> [args...]`. `undefined` is a usage error: a missing
// separator, a weight that is not an integer of at least one core, a malformed `--memory`, or nothing
// to run.
function parse_arguments(argv: ReadonlyArray<string>): ReservedCommand | undefined {
	const NOT_FOUND = -1
	const separator = argv.indexOf(COMMAND_SEPARATOR)
	const weight = Number(argv[WEIGHT_INDEX])
	const memory = parse_memory(argv.slice(WEIGHT_INDEX + 1, Math.max(separator, 0)))
	const command = argv.slice(separator + 1)

	if (separator === NOT_FOUND || !is_integer_from(weight, MIN_WEIGHT)) return undefined

	return memory !== undefined && command.length > 0 ? { weight, ...memory, command } : undefined
}

// An argument as one shell word: a plain one as written, anything else single-quoted. **The estimate
// re-reads the command as a shell line**, so `git commit -m "a; eslint ."` joined bare would be cut at
// the `;` and reserved as an eslint run.
function shell_word(argument: string): string {
	if (PLAIN_WORD.test(argument)) return argument

	return `'${argument.split("'").join(ESCAPED_QUOTE)}'`
}

// What the claim carries to the ledger: the command named on the waiting line, and the memory it
// holds — the explicit `--memory`, else the estimate read off the command (`command-memory.ts`), else
// none, which is what a command the table does not know counts.
function reservation_options(parsed: ReservedCommand): {
	command: string
	memory_mb: number | undefined
} {
	const command = parsed.command.map((argument) => shell_word(argument)).join(' ')

	return { command, memory_mb: parsed.memory_mb ?? command_memory.estimated_memory_mb(command) }
}

// The directory the caller typed the command in. **`pnpm josh` runs from the package root**, so without
// this a wrapped `eslint rules/a.ts` typed in `scripts/` would lint from the root and match nothing;
// pnpm records the caller's directory in `INIT_CWD` (joshuafolkken/kit#5147).
function command_directory(): string {
	const initial = process.env['INIT_CWD']

	return initial === undefined || initial === '' ? process.cwd() : initial
}

// `stdio: 'inherit'` so the command's own progress reaches the push, and `reject: false` so a failing
// command becomes an exit code the caller returns rather than a throw — the reservation is released by
// `with_core_reservation`'s `finally` on either path.
async function run_command(command: ReadonlyArray<string>): Promise<number> {
	const [file = '', ...args] = command
	const result = await execa(file, args, {
		cwd: command_directory(),
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAIL_EXIT_CODE
}

async function run_reserved(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse_arguments(argv)

	if (parsed === undefined) {
		process.stderr.write(
			'reserved-run: usage: reserved-run <weight> [--memory <MB>] -- <command> [args...]\n',
		)

		return FAIL_EXIT_CODE
	}

	// **A command already inside a gate's unit suite takes no place, for the reason a nested gate does
	// not**: this repository's own gate tests exercise the wrapper, and a place
	// claimed there would wait on cores the outer gate is holding. In its real use — the pre-push hook —
	// nothing has set the marker, so the reservation is taken.
	if (unit_worker_share.is_nested_run()) return await run_command(parsed.command)

	return await core_budget.with_core_reservation(
		parsed.weight,
		async () => await run_command(parsed.command),
		reservation_options(parsed),
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_reserved(process.argv.slice(FIRST_ARGUMENT_INDEX))
}

const reserved_run = { parse_arguments, reservation_options, run_reserved }

export { reserved_run }
