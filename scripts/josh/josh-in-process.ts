import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { CommandEntry } from './josh-command-types'

// `pnpm josh <script command>` started tsx twice — once for this dispatcher, once for the script it
// spawned. Measured on 2026-09-04, the second start was about 0.16 s of the 0.55 s a
// `pnpm josh format:edited` took, and the edit/Bash hook pays it 60–90 times in a single run
// (joshuafolkken/kit#1342). The script is ordinary TypeScript and a TypeScript loader is already
// installed by the time this file runs, so the dispatcher evaluates the script itself instead.
const TYPESCRIPT_EXTENSION = '.ts'
const FAILURE_EXIT_CODE = 1

// The dispatcher may only load a `.ts` script in its own process when it was itself loaded as
// TypeScript — which is exactly the condition under which a loader capable of it is present. A
// consumer runs the bundled `dist/josh.js` under plain node, whose `import.meta.url` ends in `.js`,
// so that install keeps the spawning path unchanged rather than failing on a module node cannot
// load at all.
function is_typescript_dispatcher(dispatcher_url: string): boolean {
	return dispatcher_url.endsWith(TYPESCRIPT_EXTENSION)
}

// `tsx_arguments` are node flags the script needs *before* its own code runs — today every one of
// them a form of `--env-file`, which has no in-process equivalent that reproduces node's own
// parsing and precedence. Those five commands (`doctor`, `latest:scope`, `followup`, `notify`,
// `eval:scope`) keep a process of their own; each runs at most a few times per run, so none of them
// is where the cost this saves accumulates.
function can_run_in_process(entry: CommandEntry, dispatcher_url: string): boolean {
	if (entry.script === undefined) return false
	if (entry.tsx_arguments !== undefined) return false

	return is_typescript_dispatcher(dispatcher_url)
}

// `process.exitCode` is typed `number | string | undefined`. Only the numeric form is an exit code
// this dispatcher can forward, and an unset one means the script finished without asking for one.
function read_exit_code(): number {
	const code = process.exitCode

	return typeof code === 'number' ? code : 0
}

// ESM resolution follows symlinks, so the `import.meta.url` a script's guard compares against is
// its real path. The argv this dispatcher builds has to be that same string: a checkout
// reached through a symlink would otherwise import the script cleanly, run nothing and answer 0. A
// path that cannot be resolved is left as it is, so the import below reports the failure.
function resolve_real_path(script_path: string): string {
	try {
		return realpathSync(script_path)
	} catch {
		return script_path
	}
}

// Every josh script decides whether to run its own main from
// `process.argv[1] === fileURLToPath(import.meta.url)`, so the dispatcher's argv is replaced with
// the one the spawned process would have had before the module is evaluated. It is deliberately not
// restored afterwards: the script is the program from here on, and anything it deferred past module
// evaluation would otherwise read the dispatcher's argv instead of its own.
async function run_in_process(
	script_path: string,
	script_arguments: ReadonlyArray<string>,
): Promise<number> {
	const resolved_path = resolve_real_path(script_path)

	process.argv = [process.execPath, resolved_path, ...script_arguments]

	try {
		await import(pathToFileURL(resolved_path).href)
	} catch (error) {
		// A spawned tsx printed the stack and exited 1; the same failure has to look the same here.
		console.error(error)

		return FAILURE_EXIT_CODE
	}

	return read_exit_code()
}

const josh_in_process = { can_run_in_process, run_in_process }

export { FAILURE_EXIT_CODE, josh_in_process }
