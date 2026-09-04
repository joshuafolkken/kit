import { josh_logic, UNKNOWN_COMMAND_EXIT_CODE } from './josh-logic'

const ARGV_OFFSET = 2

// `--help` and `-h` ask for the listing as plainly as the bare `help` does. They used to fall
// through to `handle_unknown`, which reached stdout only because the listing was printed there;
// routing that path to stderr for #825 would otherwise have left `josh --help` printing nothing a
// pipe could read.
const HELP_COMMANDS: ReadonlySet<string> = new Set(['help', '--help', '-h'])

function print_help(): void {
	console.info(josh_logic.format_help())
}

// Both halves go to stderr. The help listing is a diagnosis here, not the answer, and a shell
// wiring `--port $(josh port dev)` reads stdout alone, so a command name this kit cannot resolve
// has to leave that stream empty rather than substitute the whole toolkit index (#825).
function handle_unknown(cmd: string): never {
	console.error(josh_logic.format_unknown_command(cmd))
	process.exit(1)
}

// `process.exit` truncates a piped stdout at its buffer size, and since joshuafolkken/kit#1342 the
// output at risk is the script's own — `scripts/verification-gate.ts` writes its per-check blocks
// and its failure summary through this process, and sets `process.exitCode` rather than exiting for
// exactly that reason. Recording the code and letting node exit when the loop drains keeps every
// byte, and it leaves the last word with a script that finishes work after module evaluation
// returns. It is a function of its own so the assignment does not sit after an `await` in `main`,
// where `require-atomic-updates` reads any write to `process` as a possible race.
function record_exit_code(exit_code: number): void {
	if (exit_code !== 0) process.exitCode = exit_code
}

// `run_command` answers with a number for a shell command and a promise for a script it runs in
// this same process (joshuafolkken/kit#1342); `await` covers both, and the argv slice is taken
// before it because the in-process branch replaces `process.argv` with the script's own.
async function main(): Promise<void> {
	const cmd = process.argv[ARGV_OFFSET]

	if (!cmd || HELP_COMMANDS.has(cmd)) {
		print_help()

		return
	}

	const subcommand_arguments = process.argv.slice(ARGV_OFFSET + 1)
	const exit_code = await josh_logic.run_command(cmd, subcommand_arguments)

	if (exit_code === UNKNOWN_COMMAND_EXIT_CODE) handle_unknown(cmd)

	record_exit_code(exit_code)
}

await main()
