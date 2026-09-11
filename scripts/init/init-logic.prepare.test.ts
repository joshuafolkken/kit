import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const EMPTY_PATH = ''
const EXECUTABLE_MODE = 0o755
const FIX_GH_PACKAGES_CMD = 'tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'
const FIX_GH_PACKAGES_MARKER = 'fix-gh-packages'
const LEFTHOOK_INSTALL = 'lefthook install'
const PREPARE = 'prepare'
const POSTINSTALL = 'postinstall'
const SVELTE_KIT_SYNC = 'svelte-kit sync'
const FAILING_STUB = '#!/bin/sh\nexit 1\n'
const LEFTHOOK_BIN = 'lefthook'
const WARNING_MARKER = 'git hooks are NOT installed'
const OWN_PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url))

function get_prepare_after_merge(existing_prepare: string): string {
	const content = JSON.stringify({ scripts: { prepare: existing_prepare } })
	const merged = JSON.parse(init_logic.merge_prepare_lifecycle_cmd(content)) as {
		scripts: Record<string, string>
	}

	return merged.scripts['prepare'] ?? ''
}

interface PrepareRun {
	status: number
	stderr: string
}

// One spawn for every case below. The exit-code cases read `status` and the warning cases read
// `stderr`, which is the only reason two callers exist rather than one.
function spawn_prepare(prepare: string, path_value: string): PrepareRun {
	const result = spawnSync('/bin/sh', ['-c', prepare], { env: { PATH: path_value } })

	return { status: result.status ?? -1, stderr: String(result.stderr) }
}

function run_prepare(prepare: string, path_value: string): number {
	return spawn_prepare(prepare, path_value).status
}

function run_fresh_prepare(path_value: string): PrepareRun {
	return spawn_prepare(init_logic.get_suggested_scripts()[PREPARE] ?? '', path_value)
}

describe('get_suggested_scripts prepare value', () => {
	it('includes fix-gh-packages command in prepare', () => {
		const result = init_logic.get_suggested_scripts()

		expect(result[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('includes lefthook install in prepare', () => {
		const result = init_logic.get_suggested_scripts()

		expect(result[PREPARE]).toContain(LEFTHOOK_INSTALL)
	})

	it('guards lefthook so a missing binary does not abort install', () => {
		const result = init_logic.get_suggested_scripts()

		expect(result[PREPARE]).toContain('command -v lefthook >/dev/null 2>&1 && { lefthook install')
	})

	it('guards tsx so a missing binary does not abort install', () => {
		const result = init_logic.get_suggested_scripts()

		expect(result[PREPARE]).toContain('command -v tsx >/dev/null 2>&1')
	})

	it('does not end with a blanket "; true" that would mask preceding failures', () => {
		const result = init_logic.get_suggested_scripts()

		expect(result[PREPARE]?.endsWith('; true')).toBe(false)
	})

	it('tolerates each optional hook individually with "|| true"', () => {
		const result = init_logic.get_suggested_scripts()

		expect(result[PREPARE]).toContain('>&2; } || true')
		expect(result[PREPARE]).toContain('|| true) && (')
	})

	it('does not suggest a postinstall script', () => {
		const result = init_logic.get_suggested_scripts()

		expect(result).not.toHaveProperty(POSTINSTALL)
	})
})

describe('get_suggested_scripts_for_content prepare skip', () => {
	it('omits prepare when a script already runs fix-gh-packages', () => {
		const content = JSON.stringify({
			scripts: { prepare: `command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true` },
		})

		const result = init_logic.get_suggested_scripts_for_content(content)

		expect(result).not.toHaveProperty(PREPARE)
	})

	it('keeps prepare when no script runs fix-gh-packages', () => {
		const content = JSON.stringify({ scripts: { build: 'tsc' } })

		const result = init_logic.get_suggested_scripts_for_content(content)

		expect(result).toHaveProperty(PREPARE)
	})
})

describe('merge_prepare_lifecycle_cmd', () => {
	it('appends the lifecycle to an existing prepare that lacks it', () => {
		const content = JSON.stringify({ scripts: { [PREPARE]: SVELTE_KIT_SYNC } })
		const result = JSON.parse(init_logic.merge_prepare_lifecycle_cmd(content)) as {
			scripts: Record<string, string>
		}

		expect(result.scripts[PREPARE]).toContain(SVELTE_KIT_SYNC)
		expect(result.scripts[PREPARE]).toContain(LEFTHOOK_INSTALL)
		expect(result.scripts[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('returns content unchanged when prepare already runs fix-gh-packages', () => {
		const content = JSON.stringify({
			scripts: { [PREPARE]: `${SVELTE_KIT_SYNC} && ${FIX_GH_PACKAGES_CMD}; true` },
		})

		expect(init_logic.merge_prepare_lifecycle_cmd(content)).toBe(content)
	})

	it('returns content unchanged when no prepare script exists', () => {
		const content = JSON.stringify({ scripts: {} })

		expect(init_logic.merge_prepare_lifecycle_cmd(content)).toBe(content)
	})

	it('returns content unchanged when another script already runs fix-gh-packages', () => {
		const content = JSON.stringify({
			scripts: {
				[PREPARE]: SVELTE_KIT_SYNC,
				postinstall: `command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true`,
			},
		})

		expect(init_logic.merge_prepare_lifecycle_cmd(content)).toBe(content)
	})
})

describe('prepare exit-code behavior', () => {
	it('propagates a non-zero exit when a core step fails', () => {
		// `false` stands in for a failing core step (e.g. `pnpm gen`); the appended
		// optional hooks must not mask its failure.
		const prepare = get_prepare_after_merge('false')

		expect(run_prepare(prepare, EMPTY_PATH)).not.toBe(0)
	})

	it('exits zero when a core step succeeds but the optional tools are missing', () => {
		// `true` stands in for a passing core step; with an empty PATH neither
		// `lefthook` nor `tsx` is found, yet the guarded+tolerated hooks exit zero.
		const prepare = get_prepare_after_merge('true')

		expect(run_prepare(prepare, EMPTY_PATH)).toBe(0)
	})

	it('exits zero for a fresh-project prepare when the optional tools are missing', () => {
		const prepare = init_logic.get_suggested_scripts()[PREPARE] ?? ''

		expect(run_prepare(prepare, EMPTY_PATH)).toBe(0)
	})
})

// joshuafolkken/kit#1503. A missing binary and a binary that ran and failed were both swallowed by
// `|| true`, so an install leaving **zero** hooks in place exited 0 and said nothing. The stub is what
// separates them: a `lefthook` on PATH that exits non-zero is exactly what `core.hooksPath` produces.
describe('a lefthook that is present but cannot install', () => {
	const stub_directories: Array<string> = []

	function arrange_lefthook(): string {
		const directory = mkdtempSync(path.join(tmpdir(), 'init-prepare-'))

		stub_directories.push(directory)
		writeFileSync(path.join(directory, LEFTHOOK_BIN), FAILING_STUB, { mode: EXECUTABLE_MODE })

		return directory
	}

	afterEach(() => {
		for (const directory of stub_directories.splice(0)) {
			rmSync(directory, { force: true, recursive: true })
		}
	})

	it('names the failure on standard error instead of swallowing it', () => {
		const { stderr } = run_fresh_prepare(arrange_lefthook())

		expect(stderr).toContain(WARNING_MARKER)
		expect(stderr).toContain('core.hooksPath')
	})

	// The `|| true` is not what is being removed: a consumer's install must not die over a
	// developer-only hook. Only the silence is.
	it('still exits zero, so the install is not aborted', () => {
		expect(run_fresh_prepare(arrange_lefthook()).status).toBe(0)
	})

	// The ordinary production or CI install, which omits dev dependencies, has no lefthook at all and
	// must stay exactly as quiet as it was.
	it('stays silent when lefthook is simply absent', () => {
		expect(run_fresh_prepare(EMPTY_PATH).stderr).not.toContain(WARNING_MARKER)
	})
})

// The consumers already installing with zero hooks and no warning are the population
// joshuafolkken/kit#1503 is about, and they are exactly the ones both merges skip: their `prepare`
// carries the fix-gh-packages marker, which is what makes those merges return early. Without this
// upgrade the fix would reach only new projects.
const LEGACY_PREPARE = `(command -v lefthook >/dev/null 2>&1 && ${LEFTHOOK_INSTALL} || true) && (command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD} || true)`

function upgrade(prepare: string): string {
	const content = JSON.stringify({ scripts: { [PREPARE]: prepare } })
	const result = JSON.parse(init_logic.upgrade_prepare_lefthook_warning(content)) as {
		scripts: Record<string, string>
	}

	return result.scripts[PREPARE] ?? ''
}

describe('upgrade_prepare_lefthook_warning', () => {
	it('adds the warning to a prepare an earlier josh init wrote', () => {
		expect(upgrade(LEGACY_PREPARE)).toContain(WARNING_MARKER)
	})

	// The consumer's own steps sit in the same string; replacing the whole value would discard them.
	it("leaves the rest of the consumer's prepare alone", () => {
		const upgraded = upgrade(`${SVELTE_KIT_SYNC} && ${LEGACY_PREPARE}`)

		expect(upgraded).toContain(SVELTE_KIT_SYNC)
		expect(upgraded).toContain(FIX_GH_PACKAGES_CMD)
	})

	// Re-running `josh init` is idempotent, and here that holds by construction rather than by a
	// marker check: `{ ` sits between the two clauses, so the new one does not contain the old.
	it('changes nothing when the warning is already there', () => {
		const once = upgrade(LEGACY_PREPARE)

		expect(upgrade(once)).toBe(once)
	})

	it("leaves a prepare that never carried kit's lefthook clause untouched", () => {
		expect(upgrade(SVELTE_KIT_SYNC)).toBe(SVELTE_KIT_SYNC)
	})
})

// kit distributes the guarded command to every consumer and was the one repository without it: a bare
// `lefthook install` that made a fresh clone's — and every linked work tree's — `pnpm install` exit
// non-zero, which is how joshuafolkken/kit#1503 was found. `package.json` is static JSON and cannot
// import the generator, so the two are pinned together here instead.
describe("kit's own prepare", () => {
	it('carries the same guarded lefthook command it distributes to consumers', () => {
		const own = JSON.parse(readFileSync(OWN_PACKAGE_JSON, 'utf8')) as {
			scripts: Record<string, string>
		}

		expect(own.scripts['prepare']).toContain(init_logic.GUARDED_LEFTHOOK_CMD)
	})
})

describe('strip_managed_postinstall', () => {
	it('removes a kit-managed postinstall that runs fix-gh-packages', () => {
		const content = JSON.stringify({
			scripts: {
				postinstall: `command -v lefthook >/dev/null 2>&1 && ${LEFTHOOK_INSTALL}; command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true`,
				build: 'tsc',
			},
		})
		const result = JSON.parse(init_logic.strip_managed_postinstall(content)) as {
			scripts: Record<string, string>
		}

		expect(result.scripts).not.toHaveProperty(POSTINSTALL)
		expect(result.scripts['build']).toBe('tsc')
	})

	it("leaves a consumer's custom postinstall untouched", () => {
		const content = JSON.stringify({ scripts: { postinstall: 'node ./scripts/setup.js' } })

		expect(init_logic.strip_managed_postinstall(content)).toBe(content)
	})

	it('returns content unchanged when no postinstall exists', () => {
		const content = JSON.stringify({ scripts: { build: 'tsc' } })

		expect(init_logic.strip_managed_postinstall(content)).toBe(content)
	})

	it('leaves a postinstall that only mentions the marker but not the kit command', () => {
		const content = JSON.stringify({
			scripts: { postinstall: 'npm run my-fix-gh-packages-helper' },
		})

		expect(init_logic.strip_managed_postinstall(content)).toBe(content)
	})
})

// Mirrors scripts/init/init.ts apply_package_json_merges so the composed ordering
// (migrate → suggested-scripts merge → lefthook-warning upgrade → lifecycle append) is
// regression-protected. The upgrade sits where it does for a reason the steps either side encode:
// after the merge, which never overwrites an existing `prepare`, and before the append, which
// early-returns on the fix-gh-packages marker the consumer being upgraded is carrying.
function run_pipeline(content: string): Record<string, string> {
	const migrated = init_logic.strip_managed_postinstall(content)
	const merged = init_logic.merge_package_scripts(
		migrated,
		init_logic.get_suggested_scripts_for_content(migrated),
	)
	const upgraded = init_logic.upgrade_prepare_lefthook_warning(merged)
	const with_lifecycle = init_logic.merge_prepare_lifecycle_cmd(upgraded)

	return (JSON.parse(with_lifecycle) as { scripts: Record<string, string> }).scripts
}

describe('apply_package_json_merges pipeline composition', () => {
	it('fresh project gets lifecycle in prepare and no postinstall', () => {
		const scripts = run_pipeline('{"name":"app"}')

		expect(scripts[PREPARE]).toContain(LEFTHOOK_INSTALL)
		expect(scripts[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
		expect(scripts).not.toHaveProperty(POSTINSTALL)
	})

	it('preserves an existing prepare and appends the lifecycle', () => {
		const scripts = run_pipeline(
			JSON.stringify({ name: 'app', scripts: { prepare: SVELTE_KIT_SYNC } }),
		)

		expect(scripts[PREPARE]).toContain(SVELTE_KIT_SYNC)
		expect(scripts[PREPARE]).toContain(LEFTHOOK_INSTALL)
		expect(scripts[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
		expect(scripts).not.toHaveProperty(POSTINSTALL)
	})

	it('migrates a legacy kit-managed postinstall to prepare', () => {
		const legacy = `command -v lefthook >/dev/null 2>&1 && ${LEFTHOOK_INSTALL}; command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true`
		const scripts = run_pipeline(JSON.stringify({ name: 'app', scripts: { postinstall: legacy } }))

		expect(scripts).not.toHaveProperty(POSTINSTALL)
		expect(scripts[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('is idempotent on a second run', () => {
		const first = run_pipeline(
			JSON.stringify({ name: 'app', scripts: { prepare: SVELTE_KIT_SYNC } }),
		)
		const second = run_pipeline(JSON.stringify({ name: 'app', scripts: first }))

		expect(second[PREPARE]).toBe(first[PREPARE])
	})
})
