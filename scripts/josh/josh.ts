import { josh_logic } from './josh-logic'

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

function main(): void {
	const cmd = process.argv[ARGV_OFFSET]

	if (!cmd || HELP_COMMANDS.has(cmd)) {
		print_help()

		return
	}

	const subcommand_arguments = process.argv.slice(ARGV_OFFSET + 1)
	const exit_code = josh_logic.run_command(cmd, subcommand_arguments)

	if (exit_code === -1) handle_unknown(cmd)
	if (exit_code !== 0) process.exit(exit_code)
}

main()
