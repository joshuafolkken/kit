import { readFileSync } from 'node:fs'
import { plan_commands } from '#scripts/format-edited-file'
import { PACKAGE_DIR, package_path } from '#scripts/init/init-paths'
import { ESLINT_ARGS } from '#scripts/lint-parallel'
import { yaml_config_fixture } from '#scripts/yaml-config-fixture'
import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import {
	CSPELL_CACHE_FLAGS,
	ESLINT_CACHE_FLAGS,
	ESLINT_EDIT_CACHE_FLAGS,
	ESLINT_RELATED_CACHE_FLAGS,
	IGNORED_CACHE_FILES,
	TS_CACHE_FLAGS,
} from './josh-command-types'

// joshuafolkken/kit#1256: the type check and the spell check used to rescan the whole tree on every
// run. What makes them incremental is a flag on the command definition and an ignore rule naming the
// file that flag writes, and neither half fails visibly on its own: drop the flag and the gate is
// merely slow again, drop the ignore rule and a multi-hundred-kilobyte cache file is committed —
// or, worse, spell-checked, which is a red gate with nothing misspelled in the tree.
const GITIGNORE_PATHS: ReadonlyArray<string> = ['.gitignore', 'templates/gitignore']
// The distributed dictionary. A consumer's `.gitignore` only gains the patterns on its next
// `josh sync`, while the flags that write the files arrive with the package itself, so the
// exclusion cannot rest on `useGitignore` alone.
const DISTRIBUTED_CSPELL_CONFIG = 'cspell/index.yaml'
// A file that really is in the repository and really is one the edit hook formats, so `plan_commands`
// below answers with the command the hook would run rather than with nothing.
const HOOK_SOURCE = 'scripts/format-edited-file.ts'

interface CspellConfig {
	ignorePaths?: Array<string>
}

// Joined rather than compared element-wise: `--tsBuildInfoFile` and `.tsbuildinfo` are a flag and
// its value, and a membership check passes on an order that would make `tsc` read `--incremental`
// as the file name.
function command_line_of(command_name: string): string {
	return (COMMAND_MAP[command_name]?.shell ?? []).join(' ')
}

function read_ignore_lines(relative_path: string): Array<string> {
	return readFileSync(package_path(relative_path), 'utf8')
		.split('\n')
		.map((line) => line.trim())
}

function read_cspell_ignore_paths(): Array<string> {
	const config = yaml_config_fixture.load_yaml_config(DISTRIBUTED_CSPELL_CONFIG) as CspellConfig

	return config.ignorePaths ?? []
}

describe('verification gate cache flags', () => {
	it('type-checks incrementally into a named build-info file', () => {
		expect(command_line_of('check')).toContain(TS_CACHE_FLAGS.join(' '))
	})

	it('spell-checks from a content-addressed cache at a named location', () => {
		expect(command_line_of('cspell:dot')).toContain(CSPELL_CACHE_FLAGS.join(' '))
	})

	it('keeps the eslint cache the other two were modelled on', () => {
		expect(command_line_of('lint:eslint')).toContain(ESLINT_CACHE_FLAGS.join(' '))
	})

	// `josh lint` runs `lint-parallel.ts`, never the `lint:eslint` map entry, so asserting only the
	// entry above would stay green while the gate's own lint step wrote a cache nothing ignores.
	it('runs the gate lint step through the same eslint cache', () => {
		expect(ESLINT_ARGS.join(' ')).toContain(ESLINT_CACHE_FLAGS.join(' '))
	})

	it('formats through the same eslint cache the lint check uses', () => {
		expect(command_line_of('format')).toContain(ESLINT_CACHE_FLAGS.join(' '))
	})
})

// joshuafolkken/kit#1332: the `PostToolUse` edit hook runs eslint too, and ESLint started *without*
// `--cache` deletes whatever sits at `--cache-location` — so every single edit destroyed the cache
// the gate had just filled, and both gates of a run then paid a cold lint (59.4s and 54.5s, against
// 3.0s warm). Two things have to hold, and neither implies the other: the hook has to pass the flags
// at all, and it has to pass a location that is not the gate's — the two run concurrently, and each
// eslint run rewrites its cache file whole from the copy it loaded at start-up, so a shared file
// would have the two writers silently discarding each other's entries.
describe('the edit hook keeps off the cache the gate reads', () => {
	// Read off the command the hook actually builds rather than off the constant it builds it from,
	// and joined rather than compared by membership: a flag and its value are a pair, and a membership
	// check passes on an order that would make eslint read `--cache-strategy` as the location. The
	// edited path is required to follow them, so the flags cannot drift apart from the file they
	// govern.
	it('lints an edited file through a cache of its own', () => {
		const edited_path = package_path(HOOK_SOURCE)
		const [eslint_command] = plan_commands(edited_path, PACKAGE_DIR)

		expect(eslint_command?.command_arguments.join(' ')).toContain(
			`${ESLINT_EDIT_CACHE_FLAGS.join(' ')} ${edited_path}`,
		)
	})

	it('never names the cache file the gate writes', () => {
		expect(ESLINT_EDIT_CACHE_FLAGS.at(-1)).not.toBe(ESLINT_CACHE_FLAGS.at(-1))
	})
})

// joshuafolkken/kit#1347, the first of the two defects it records: ESLint decides a cache entry is
// still valid from the file's content hash plus a hash of the *serialized* config, and serializing
// drops every rule's `create` — so editing `eslint/rules/*.js` left every entry in every cache file
// valid, and `pnpm josh lint` reported the pre-edit verdict for each file the change did not touch.
// The fix is one value in the shared config (`eslint/config-fingerprint.js`), which is why what has to
// be asserted here is that **neither side steps around that config**. A run given `--config` or
// `--no-config-lookup` would lint against something else and keep its stale entries, with every test
// in `eslint/config-fingerprint.test.ts` still green.
describe('a rule-module edit invalidates both sides', () => {
	const CONFIG_BYPASS_FLAGS: ReadonlyArray<string> = ['--config', '-c', '--no-config-lookup']

	it('lints the gate through the project config the fingerprint lives in', () => {
		for (const flag of CONFIG_BYPASS_FLAGS) {
			expect(ESLINT_ARGS, `the gate lint bypasses the project config with ${flag}`).not.toContain(
				flag,
			)
		}
	})

	it('lints an edited file through that same project config', () => {
		const [eslint_command] = plan_commands(package_path(HOOK_SOURCE), PACKAGE_DIR)

		for (const flag of CONFIG_BYPASS_FLAGS) {
			expect(
				eslint_command?.command_arguments ?? [],
				`the edit hook bypasses the project config with ${flag}`,
			).not.toContain(flag)
		}
	})
})

// joshuafolkken/kit#1347, the second defect: `josh gate` lints the whole tree beside the review while
// an implementation loop calls `josh lint:related` between edits, so those two overlap exactly as the
// hook and the gate do. Each eslint run rewrites its cache file whole from the copy it loaded at
// start-up, so on one file the run that finished last discarded the other's entries.
// That the scoped lint actually runs against its own location is asserted where the arguments are
// built, in `scripts/lint-related-scope.test.ts`; what belongs here is the property no single command
// can state — that the three locations are three files.
//
// **The three are the runs a workflow can have in flight at once**, not every eslint run in the
// package. `josh health`, `josh format` and `josh lint:fix` still write the gate's `.eslintcache`, and
// deliberately so: each lints the whole tree, so its entries are the gate's own, and none of them is
// started by a run while the gate is going. Reading this as "no two eslint runs ever share a file"
// would over-claim.
describe('the three runs a workflow can have in flight never share a cache file', () => {
	it('gives each of them a location of its own', () => {
		const locations = [ESLINT_CACHE_FLAGS, ESLINT_EDIT_CACHE_FLAGS, ESLINT_RELATED_CACHE_FLAGS].map(
			(flags) => flags.at(-1),
		)

		expect(new Set(locations).size).toBe(locations.length)
	})
})

describe('cache files stay out of the repository', () => {
	for (const relative_path of GITIGNORE_PATHS) {
		it(`${relative_path} ignores every cache this package writes`, () => {
			const lines = read_ignore_lines(relative_path)

			for (const cache_file of IGNORED_CACHE_FILES) {
				expect(lines, `${relative_path} does not ignore ${cache_file}`).toContain(cache_file)
			}
		})
	}

	it(`${DISTRIBUTED_CSPELL_CONFIG} excludes them without waiting for a josh sync`, () => {
		const ignore_paths = read_cspell_ignore_paths()

		for (const cache_file of IGNORED_CACHE_FILES) {
			expect(ignore_paths, `${cache_file} is not excluded`).toContain(`**/${cache_file}`)
		}
	})
})
