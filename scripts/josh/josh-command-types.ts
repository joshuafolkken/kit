import { ENV_FILE_NAME } from '#ports'

// The filename comes from the module that reads the same file from inside `playwright.config.ts`,
// so the two readers of `.env` cannot end up pointed at two different files (#820).
const ENV_FILE_FLAGS: ReadonlyArray<string> = [`--env-file=${ENV_FILE_NAME}`]
// The same file, loaded only when it is there. `doctor` is run from anywhere — a home directory, a
// clone of an unrelated project — where `.env` need not exist, and the hard flag above aborts the
// command when the file is missing (joshuafolkken/kit#869).
const OPTIONAL_ENV_FILE_FLAGS: ReadonlyArray<string> = [`--env-file-if-exists=${ENV_FILE_NAME}`]

type CommandCategory =
	'Development' | 'Project' | 'Workflow' | 'Versioning' | 'Maintenance' | 'Git hooks' | 'AI tools'

interface CommandEntry {
	script?: string
	shell?: ReadonlyArray<string>
	description: string
	category: CommandCategory
	tsx_arguments?: ReadonlyArray<string>
	default_script_arguments?: ReadonlyArray<string>
	// Composite (`sh -c`) commands reject extra CLI arguments instead of swallowing them; this
	// names the sub-commands that do accept them, so the refusal points somewhere useful.
	argument_targets?: ReadonlyArray<string>
}

// The name `josh gate` registers under. It lives here rather than in `verification-gate.ts` so a
// consumer of the name — the command map, `propagate` — does not import the script module: that
// module carries a `process.argv[1] === import.meta.url` main guard, and esbuild bundles every
// import into one `dist/josh.js` where that guard matches on *any* `josh` invocation
// (joshuafolkken/kit#914).
const GATE_COMMAND = 'gate'

const PE = ['pnpm', 'exec'] as const
const ESLINT_CACHE_FLAGS = ['--cache', '--cache-strategy', 'content'] as const

export type { CommandCategory, CommandEntry }
export { ENV_FILE_FLAGS, ESLINT_CACHE_FLAGS, GATE_COMMAND, OPTIONAL_ENV_FILE_FLAGS, PE }
