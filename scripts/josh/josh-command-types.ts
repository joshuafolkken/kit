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
// Neither of those two needs an invalidation rule of its own. `tsc` records the compiler options
// inside the build-info file and re-checks everything when they differ, and `cspell` records a
// content hash of every config and dictionary file it loaded as that entry's dependency — so editing
// `tsconfig.json` or `cspell.config.yaml` invalidates what it should. CI restores only the eslint
// cache (`.github/workflows/ci.yml` → "Setup ESLint cache"); the other two start every run cold.
//
// **eslint's does need one, and it is not here** (joshuafolkken/kit#1347). ESLint hashes the
// *serialized* config, which drops every rule's `create`, so editing `eslint/rules/*.js` left every
// cached entry valid on every cache file below. The fix is a content fingerprint of the rule modules
// carried in the shared config's `settings` — `eslint/config-fingerprint.js` — because one value
// there invalidates the gate's cache, the scoped one and the edit hook's at once, while a rule
// written per cache file would have to be repeated for each and would go stale one file at a time.
//
// Every location is passed explicitly rather than left to the tool's default, eslint's included:
// the ignore rules have to name the same paths, and a constant that merely copies a default is
// wrong the moment the default moves without anything failing. `IGNORED_CACHE_FILES` below is what
// the ignore rules are asserted against — `.gitignore` (which `useGitignore` also makes the spell
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

// joshuafolkken/kit#1332: the `PostToolUse` edit hook runs eslint too, and ESLint *deletes* the file
// at `--cache-location` whenever it is started without `--cache` — so every single edit wiped the
// cache the gate had just filled, and both gates of run joshuafolkken/kit#1326 paid a cold lint
// (59.4s and 54.5s, against 3.0s warm). The hook is given a location of its own rather than the
// gate's because the two run at the same time: `josh gate` lints the whole tree beside the review
// while this hook fires on every edit, and each eslint run rewrites its cache file whole from the
// copy it loaded at start-up — so two writers silently discard each other's entries. A file of its
// own makes the hook structurally unable to degrade the cache this exists to protect.
//
// **Pruning is not the reason**, though it reads like one: `file-entry-cache` defaults `noPrune` to
// true, and a single-file run against the gate's full cache was measured byte-identical, so a shared
// file would keep the entries that run never visited.
const ESLINT_EDIT_CACHE_FILE = '.eslintcache.edit'
// joshuafolkken/kit#1347: the same reasoning, reached a second time. `josh lint:related` is what an
// implementation loop calls between edits, and `josh gate` lints the whole tree beside the review —
// so those two run at the same time as readily as the hook and the gate do, and they shared one file
// until this constant existed. Whichever of the pair wrote last replaced the file with "the copy I
// loaded at start-up plus what I visited", so a narrowed run finishing during a whole-tree run rolled
// the cache back to its pre-gate state, and a whole-tree run finishing second discarded the narrowed
// one's entries.
//
// **The warming this gives up is worth less than the entries it stops losing.** The comment this
// replaced argued the shared file let a narrowed run warm the gate's cache, which is true only while
// the two never overlap; a file of its own is warm from its own second call onwards, and the gate's
// stays exactly as the gate left it.
//
// **The lint's target scope is untouched.** This is where a cache is written, not what is read:
// `josh lint:related` narrows in front of the gate and `josh gate` still runs `josh lint` over the
// whole tree before any commit.
const ESLINT_RELATED_CACHE_FILE = '.eslintcache.related'
// What the ignore rules are asserted against: every cache file this package writes, wherever it is
// written from. The gate's three, the edit hook's, and the scoped lint's — a cache file that is not
// ignored is committed, or spell-checked, which is a red gate with nothing misspelled in the tree.
const IGNORED_CACHE_FILES: ReadonlyArray<string> = [
	...GATE_CACHE_FILES,
	ESLINT_EDIT_CACHE_FILE,
	ESLINT_RELATED_CACHE_FILE,
]

// `--cache --cache-strategy content` is one convention rather than two coincidences: cspell adopted
// eslint's spelling for its own cache flags, so the pair is single-sourced here.
const CONTENT_CACHE_FLAGS = ['--cache', '--cache-strategy', 'content'] as const
const CACHE_LOCATION_FLAG = '--cache-location'

// Four locations are written with these same four flags — the gate's eslint cache, the scoped lint's,
// the edit hook's and the spell check's — so the sequence is built here once. Spelled out per
// location, a fix to the order would have to be made four times and each copy fails silently: a flag
// and its value are one unit, and a wrong order makes the tool read `--cache-strategy` as the file
// name rather than erroring.
function content_cache_flags(cache_file: string): ReadonlyArray<string> {
	return [...CONTENT_CACHE_FLAGS, CACHE_LOCATION_FLAG, cache_file]
}

const ESLINT_CACHE_FLAGS = content_cache_flags(ESLINT_CACHE_FILE)
const ESLINT_EDIT_CACHE_FLAGS = content_cache_flags(ESLINT_EDIT_CACHE_FILE)
const ESLINT_RELATED_CACHE_FLAGS = content_cache_flags(ESLINT_RELATED_CACHE_FILE)
const TS_CACHE_FLAGS = ['--incremental', '--tsBuildInfoFile', TS_BUILD_INFO_FILE] as const
const CSPELL_CACHE_FLAGS = content_cache_flags(CSPELL_CACHE_FILE)

export type { CommandCategory, CommandEntry }
// The three cache files are exported one by one as well as as a list, because `josh bench` clears
// them per target (joshuafolkken/kit#1314): the lint step writes only the eslint one, so a target
// that cleared the list would report a cold type check as the lint's own cost. The edit hook's
// `.eslintcache.edit` and the scoped lint's `.eslintcache.related` are deliberately not exported
// here — nothing but their own command may touch either, which is the whole of joshuafolkken/kit#1332
// and joshuafolkken/kit#1347. Their *flags* are exported, so the one command that writes each file
// names it from here rather than spelling it out again.
export {
	CSPELL_CACHE_FILE,
	CSPELL_CACHE_FLAGS,
	ENV_FILE_FLAGS,
	ESLINT_CACHE_FILE,
	ESLINT_CACHE_FLAGS,
	ESLINT_EDIT_CACHE_FLAGS,
	ESLINT_RELATED_CACHE_FLAGS,
	GATE_CACHE_FILES,
	GATE_COMMAND,
	IGNORED_CACHE_FILES,
	OPTIONAL_ENV_FILE_FLAGS,
	PE,
	TS_BUILD_INFO_FILE,
	TS_CACHE_FLAGS,
}
