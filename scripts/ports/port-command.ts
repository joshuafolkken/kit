#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { ports, type PortEnvironment } from '#ports'

const SUCCESS_EXIT_CODE = 0
const USAGE_EXIT_CODE = 1
const FAILURE_EXIT_CODE = 1
const EXPECTED_ARGUMENT_COUNT = 1
const ARGV_OFFSET = 2

type PortName = 'dev' | 'preview'

interface PortResult {
	text: string
	exit_code: number
}

const RESOLVERS: Record<PortName, (environment?: PortEnvironment) => number> = {
	dev: ports.resolve_development_port,
	preview: ports.resolve_preview_port,
}

const PORT_NAMES: ReadonlyArray<string> = Object.keys(RESOLVERS)
const USAGE = `Usage: josh port <${PORT_NAMES.join('|')}>`

function is_port_name(value: string | undefined): value is PortName {
	return value !== undefined && Object.hasOwn(RESOLVERS, value)
}

// Shell contexts cannot import the resolver, so `$(josh port preview)` is how a package.json
// script stays on kit's single port definition instead of re-deriving the arithmetic. The output is
// substituted straight into a command line, so success prints the number and nothing else; anything
// else would corrupt the port argument it feeds. The documented form calls the binary rather than
// `pnpm josh`, because a `pnpm run` wrapper writes its own `[ELIFECYCLE]` line and any install log
// to that same stream and nothing here can suppress them (#825).
function run(argv: ReadonlyArray<string>, environment?: PortEnvironment): PortResult {
	const [name] = argv

	// An extra argument is refused rather than ignored: `josh port dev preview` printing the dev
	// port would feed a silently wrong number into the command line that substitutes it.
	if (argv.length !== EXPECTED_ARGUMENT_COUNT || !is_port_name(name)) {
		return { text: USAGE, exit_code: USAGE_EXIT_CODE }
	}

	// An invalid `PORT_SEED` throws out of the resolver. Reporting the message alone keeps the
	// failure readable in the terminal that ran `pnpm preview`, where a raw stack trace would bury
	// the one line saying which variable to fix.
	try {
		return { text: String(RESOLVERS[name](environment)), exit_code: SUCCESS_EXIT_CODE }
	} catch (error) {
		return {
			text: error instanceof Error ? error.message : String(error),
			exit_code: FAILURE_EXIT_CODE,
		}
	}
}

// #826: the resolver finds `.env` at the project root, where `pnpm run` starts the scripts that
// substitute this command's output. It replaces the `--env-file-if-exists=.env` tsx flag this
// command used to carry, which resolved relative to the working directory instead — so running the
// command from a subdirectory answered with the unseeded port while `playwright.config.ts`, which
// already uses this resolver, answered with the seeded one. One reader, one file.
function main(argv: ReadonlyArray<string>): void {
	ports.load_environment_file()

	const { text, exit_code } = run(argv)

	if (exit_code === SUCCESS_EXIT_CODE) {
		console.info(text)

		return
	}

	console.error(text)
	process.exit(exit_code)
}

const port_command = {
	is_port_name,
	run,
	PORT_NAMES,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export { port_command }
