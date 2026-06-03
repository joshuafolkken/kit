import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

function get_prepare_after_merge(existing_prepare: string): string {
	const content = JSON.stringify({ scripts: { prepare: existing_prepare } })
	const merged = JSON.parse(init_logic.merge_prepare_lifecycle_cmd(content)) as {
		scripts: Record<string, string>
	}

	// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
	return merged.scripts['prepare'] ?? ''
}

function run_prepare(prepare: string, path: string): number {
	const result = spawnSync('/bin/sh', ['-c', prepare], { env: { PATH: path } })

	return result.status ?? -1
}

const FIX_GH_PACKAGES_CMD = 'tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'
const FIX_GH_PACKAGES_MARKER = 'fix-gh-packages'
const LEFTHOOK_INSTALL = 'lefthook install'
const PREPARE = 'prepare'
const POSTINSTALL = 'postinstall'
const VANILLA = 'vanilla'
const SVELTE_KIT_SYNC = 'svelte-kit sync'

describe('get_suggested_scripts prepare value', () => {
	it('includes fix-gh-packages command in prepare', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('includes lefthook install in prepare', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[PREPARE]).toContain(LEFTHOOK_INSTALL)
	})

	it('guards lefthook so a missing binary does not abort install', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[PREPARE]).toContain('command -v lefthook >/dev/null 2>&1 && lefthook install')
	})

	it('guards tsx so a missing binary does not abort install', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[PREPARE]).toContain('command -v tsx >/dev/null 2>&1')
	})

	it('does not end with a blanket "; true" that would mask preceding failures', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[PREPARE]?.endsWith('; true')).toBe(false)
	})

	it('tolerates each optional hook individually with "|| true"', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[PREPARE]).toContain(
			'command -v lefthook >/dev/null 2>&1 && lefthook install || true',
		)
		expect(result[PREPARE]).toContain('|| true) && (')
	})

	it('does not suggest a postinstall script', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result).not.toHaveProperty(POSTINSTALL)
	})
})

describe('get_suggested_scripts_for_content prepare skip', () => {
	it('omits prepare when a script already runs fix-gh-packages', () => {
		const content = JSON.stringify({
			scripts: { prepare: `command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true` },
		})

		const result = init_logic.get_suggested_scripts_for_content(VANILLA, content)

		expect(result).not.toHaveProperty(PREPARE)
	})

	it('keeps prepare when no script runs fix-gh-packages', () => {
		const content = JSON.stringify({ scripts: { build: 'tsc' } })

		const result = init_logic.get_suggested_scripts_for_content(VANILLA, content)

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
	const EMPTY_PATH = ''

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
		const prepare = init_logic.get_suggested_scripts(VANILLA)[PREPARE] ?? ''

		expect(run_prepare(prepare, EMPTY_PATH)).toBe(0)
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
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
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

// Mirrors scripts/init.ts apply_package_json_merges so the composed ordering
// (migrate → suggested-scripts merge → lifecycle append) is regression-protected.
function run_pipeline(content: string, type: 'sveltekit' | 'vanilla'): Record<string, string> {
	const migrated = init_logic.strip_managed_postinstall(content)
	const merged =
		type === 'sveltekit'
			? init_logic.merge_sveltekit_package_json(migrated)
			: init_logic.merge_package_scripts(
					migrated,
					init_logic.get_suggested_scripts_for_content(type, migrated),
				)
	const with_lifecycle = init_logic.merge_prepare_lifecycle_cmd(merged)

	return (JSON.parse(with_lifecycle) as { scripts: Record<string, string> }).scripts
}

describe('apply_package_json_merges pipeline composition', () => {
	it('vanilla fresh project gets lifecycle in prepare and no postinstall', () => {
		const scripts = run_pipeline('{"name":"app"}', 'vanilla')

		expect(scripts[PREPARE]).toContain(LEFTHOOK_INSTALL)
		expect(scripts[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
		expect(scripts).not.toHaveProperty(POSTINSTALL)
	})

	it('sveltekit preserves an existing prepare and appends the lifecycle', () => {
		const scripts = run_pipeline(
			JSON.stringify({ name: 'app', scripts: { prepare: SVELTE_KIT_SYNC } }),
			'sveltekit',
		)

		expect(scripts[PREPARE]).toContain(SVELTE_KIT_SYNC)
		expect(scripts[PREPARE]).toContain(LEFTHOOK_INSTALL)
		expect(scripts[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
		expect(scripts).not.toHaveProperty(POSTINSTALL)
	})

	it('migrates a legacy kit-managed postinstall to prepare', () => {
		const legacy = `command -v lefthook >/dev/null 2>&1 && ${LEFTHOOK_INSTALL}; command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true`
		const scripts = run_pipeline(
			JSON.stringify({ name: 'app', scripts: { postinstall: legacy } }),
			'vanilla',
		)

		expect(scripts).not.toHaveProperty(POSTINSTALL)
		expect(scripts[PREPARE]).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('is idempotent on a second run', () => {
		const first = run_pipeline(
			JSON.stringify({ name: 'app', scripts: { prepare: SVELTE_KIT_SYNC } }),
			'sveltekit',
		)
		const second = run_pipeline(JSON.stringify({ name: 'app', scripts: first }), 'sveltekit')

		expect(second[PREPARE]).toBe(first[PREPARE])
	})
})
