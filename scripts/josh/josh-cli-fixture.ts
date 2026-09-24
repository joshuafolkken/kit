import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { resolve_tsx_runner } from './josh-logic'

// Two suites need to run the real CLI rather than its parts: the stdout contract every command
// answers on, and the `.env` the `port` command resolves from a working directory. Sharing the
// spawn keeps them on one definition of "the CLI" — the same tsx runner the dispatcher itself uses,
// rather than `node_modules/.bin/tsx`, whose pnpm shim hardcodes a store path that goes stale after
// a tsx bump (see `resolve_tsx_cli_from`).
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const JOSH_ENTRY = path.join(REPO_ROOT, 'scripts', 'josh', 'josh.ts')
const TSX_RUNNER = resolve_tsx_runner()
const PORT_SEED_KEY = 'PORT_SEED'

interface JoshLauncher {
	executable: string
	leading_arguments: ReadonlyArray<string>
}

// The source CLI as one launcher, so the integration harness spawns exactly what `run_josh` does.
const SOURCE_JOSH: JoshLauncher = {
	executable: TSX_RUNNER.executable,
	leading_arguments: [...TSX_RUNNER.leading_arguments, JOSH_ENTRY],
}

interface CliResult {
	stdout: string
	exit_code: number | undefined
}

interface CliOptions {
	seed?: string | undefined
	cwd?: string | undefined
}

// The seed is always written, `undefined` included: the child inherits this process's environment,
// so a developer who exports `PORT_SEED` would otherwise decide what these assertions see.
function run_josh(cli_arguments: ReadonlyArray<string>, options: CliOptions = {}): CliResult {
	const result = execaSync(
		SOURCE_JOSH.executable,
		[...SOURCE_JOSH.leading_arguments, ...cli_arguments],
		{
			cwd: options.cwd ?? REPO_ROOT,
			reject: false,
			env: { [PORT_SEED_KEY]: options.seed },
		},
	)

	return { stdout: result.stdout, exit_code: result.exitCode }
}

const josh_cli_fixture = { run_josh, REPO_ROOT, SOURCE_JOSH }

export type { CliResult, JoshLauncher }
export { josh_cli_fixture }
