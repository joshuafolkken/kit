#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { core_budget } from '#scripts/gate/core-budget'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { execa } from 'execa'

// Runs a command while holding a place in the machine-wide core budget (joshuafolkken/kit#2351).
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

interface ReservedCommand {
	weight: number
	command: ReadonlyArray<string>
}

// `<weight> -- <command> [args...]`. `undefined` is a usage error: a missing separator, a weight that
// is not an integer of at least one core, or nothing to run.
function parse_arguments(argv: ReadonlyArray<string>): ReservedCommand | undefined {
	const NOT_FOUND = -1
	const separator = argv.indexOf(COMMAND_SEPARATOR)
	const weight = Number(argv[WEIGHT_INDEX])
	const is_valid_weight = Number.isSafeInteger(weight) && weight >= MIN_WEIGHT

	if (separator === NOT_FOUND || !is_valid_weight) return undefined

	const command = argv.slice(separator + 1)

	return command.length > 0 ? { weight, command } : undefined
}

// `stdio: 'inherit'` so the command's own progress reaches the push, and `reject: false` so a failing
// command becomes an exit code the caller returns rather than a throw — the reservation is released by
// `with_core_reservation`'s `finally` on either path.
async function run_command(command: ReadonlyArray<string>): Promise<number> {
	const [file, ...args] = command
	const result = await execa(file ?? '', args, { stdio: 'inherit', reject: false })

	return result.exitCode ?? FAIL_EXIT_CODE
}

async function run_reserved(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse_arguments(argv)

	if (parsed === undefined) {
		process.stderr.write('reserved-run: usage: reserved-run <weight> -- <command> [args...]\n')

		return FAIL_EXIT_CODE
	}

	// **A command already inside a gate's unit suite takes no place, for the reason a nested gate does
	// not** (joshuafolkken/kit#2351): this repository's own gate tests exercise the wrapper, and a place
	// claimed there would wait on cores the outer gate is holding. In its real use — the pre-push hook —
	// nothing has set the marker, so the reservation is taken.
	if (unit_worker_share.is_nested_run()) return await run_command(parsed.command)

	return await core_budget.with_core_reservation(
		parsed.weight,
		async () => await run_command(parsed.command),
	)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_reserved(process.argv.slice(FIRST_ARGUMENT_INDEX))
}

const reserved_run = { parse_arguments, run_command, run_reserved }

export { reserved_run }
