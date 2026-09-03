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

// joshuafolkken/kit#1256: three of the gate's four checks keep a content-addressed cache, so a
// second run reads only what changed. eslint had one from the start; the type check and the spell
// check rescanned the whole tree every time, which cost 10.5s of CPU against 2.8s cached.
//
// Neither cache needs an invalidation rule of its own. `tsc` records the compiler options inside
// the build-info file and re-checks everything when they differ, and `cspell` records a content
// hash of every config and dictionary file it loaded as that entry's dependency — so editing
// `tsconfig.json` or `cspell.config.yaml` invalidates what it should. CI restores only the eslint
// cache (`.github/workflows/ci.yml` → "Setup ESLint cache"); the other two start every run cold.
//
// Every location is passed explicitly rather than left to the tool's default, eslint's included:
// the ignore rules have to name the same paths, and a constant that merely copies a default is
// wrong the moment the default moves without anything failing. `GATE_CACHE_FILES` is what the
// ignore rules are asserted against — `.gitignore` (which `useGitignore` also makes the spell
// check's exclusion) and the distributed `cspell/index.yaml`, which does not wait for a
// `josh sync` to reach a consumer.
const ESLINT_CACHE_FILE = '.eslintcache'
const TS_BUILD_INFO_FILE = '.tsbuildinfo'
const CSPELL_CACHE_FILE = '.cspellcache'
const GATE_CACHE_FILES: ReadonlyArray<string> = [
	ESLINT_CACHE_FILE,
	TS_BUILD_INFO_FILE,
	CSPELL_CACHE_FILE,
]

// `--cache --cache-strategy content` is one convention rather than two coincidences: cspell adopted
// eslint's spelling for its own cache flags, so the pair is single-sourced here.
const CONTENT_CACHE_FLAGS = ['--cache', '--cache-strategy', 'content'] as const
const CACHE_LOCATION_FLAG = '--cache-location'
const ESLINT_CACHE_FLAGS = [...CONTENT_CACHE_FLAGS, CACHE_LOCATION_FLAG, ESLINT_CACHE_FILE] as const
const TS_CACHE_FLAGS = ['--incremental', '--tsBuildInfoFile', TS_BUILD_INFO_FILE] as const
const CSPELL_CACHE_FLAGS = [...CONTENT_CACHE_FLAGS, CACHE_LOCATION_FLAG, CSPELL_CACHE_FILE] as const

export type { CommandCategory, CommandEntry }
export {
	CSPELL_CACHE_FLAGS,
	ENV_FILE_FLAGS,
	ESLINT_CACHE_FLAGS,
	GATE_CACHE_FILES,
	GATE_COMMAND,
	OPTIONAL_ENV_FILE_FLAGS,
	PE,
	TS_CACHE_FLAGS,
}
