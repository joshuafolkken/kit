import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { resolve_tsx_runner } from '#scripts/josh/josh-logic'
import { eslint_daemon } from './eslint-daemon'

// Warms a fresh checkout's eslint daemon before its first edit (joshuafolkken/kit#4720). A cold
// daemon took 5–8 s on the first edit hook's lint and 0.1–1.3 s once warm; `eslint_d start` alone
// warms nothing — its first lint still took 8 s — because the cost is eslint loading the config, the
// plugins and the type program, which only a lint of a typed source pays.
//
// **The lint goes through `eslint_daemon.run` rather than the bare daemon**, so the daemon it starts
// is recorded with its fingerprint: an unrecorded one is stale to `josh lint:related` and the
// pre-commit hook, which would stop and cold-start it on their first run.

const WARM_CLI = fileURLToPath(new URL('eslint-warm-cli.ts', import.meta.url))
// One typed source the type program covers; a declaration file can be ignored by the flat config.
const TYPED_SOURCES: ReadonlyArray<string> = ['ls-files', '--', '*.ts', ':!*.d.ts']
// A project with no TypeScript still loads its config and plugins through this.
const FALLBACK_TARGET = 'eslint.config.js'
const LINE_SEPARATOR = '\n'

function warm_target(project_root: string): string {
	const listed = git_spawn_sync.read(TYPED_SOURCES, { cwd: project_root }) ?? ''
	const [first] = listed.split(LINE_SEPARATOR)

	return first === undefined || first === '' ? FALLBACK_TARGET : first
}

async function warm(project_root: string): Promise<void> {
	await eslint_daemon.run(['exec', 'eslint', warm_target(project_root)], { project_root })
}

function ignore_error(): void {
	// A warm-up that could not start leaves the first edit cold, as it was before.
}

// Detached and unreferenced, so the caller neither waits for the lint nor keeps its process alive
// for it. Best-effort: nothing here may fail the caller.
function start(project_root: string): void {
	try {
		const runner = resolve_tsx_runner()
		const options = { cwd: project_root, detached: true, stdio: 'ignore' } as const
		const child = spawn(runner.executable, [...runner.leading_arguments, WARM_CLI], options)

		child.on('error', ignore_error)
		child.unref()
	} catch {
		ignore_error()
	}
}

const eslint_warm = { start, warm }

export { eslint_warm }
