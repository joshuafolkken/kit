import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const BUILD_KEY = 'build'
const PREPARE_KEY = 'prepare'
const WRANGLER_TYPES = 'wrangler types'
const WRANGLER_GUARD = '[ -f wrangler.jsonc ]'
const SVELTE_KIT_SYNC = 'svelte-kit sync'
const VITE_BUILD = 'vite build && pnpm run prepack'

// Sub-script keys (colon/hyphen names) addressed via computed keys so the naming-convention
// rule does not flag the literal property names; the `pnpm <key>` references are built from
// the same constants so no command string is duplicated.
const PREPARE_GEN_KEY = 'prepare:gen'
const PREPARE_SYNC_KEY = 'prepare:sync'
const GEN_KEY = 'gen'
const GEN_PRE_KEY = 'gen:pre'
const STEP_A_KEY = 'step-a'
const STEP_B_KEY = 'step-b'

// The app-kit shape: `prepare` reaches `wrangler types` only indirectly, through
// `pnpm prepare:gen` → `pnpm gen` → `wrangler types`. The literal substring guard cannot see
// this, so the append must be suppressed by the transitive-coverage resolver instead.
const APP_KIT_COVERED = JSON.stringify({
	scripts: {
		[PREPARE_KEY]: `pnpm ${PREPARE_GEN_KEY} && pnpm ${PREPARE_SYNC_KEY}`,
		[PREPARE_GEN_KEY]: `[ ! -f wrangler.jsonc ] || pnpm ${GEN_KEY}`,
		[PREPARE_SYNC_KEY]: SVELTE_KIT_SYNC,
		[GEN_KEY]: `pnpm ${GEN_PRE_KEY} && ${WRANGLER_TYPES}`,
		[GEN_PRE_KEY]: 'echo pre',
	},
})

function scripts_of(content: string): Record<string, string> {
	return (JSON.parse(content) as { scripts: Record<string, string> }).scripts
}

function run_prepare(prepare: string, path: string, cwd: string): number {
	const result = spawnSync('/bin/sh', ['-c', prepare], { cwd, env: { PATH: path } })

	return result.status ?? -1
}

describe('strip_wrangler_types_from_build', () => {
	it('removes wrangler types from the build pipeline', () => {
		const content = JSON.stringify({
			scripts: { [BUILD_KEY]: `${WRANGLER_TYPES} && ${VITE_BUILD}` },
		})
		const result = scripts_of(init_logic.strip_wrangler_types_from_build(content))

		expect(result[BUILD_KEY]).toBe(VITE_BUILD)
		expect(result[BUILD_KEY]).not.toContain(WRANGLER_TYPES)
	})

	it('leaves a build without wrangler types unchanged', () => {
		const content = JSON.stringify({ scripts: { [BUILD_KEY]: VITE_BUILD } })

		expect(init_logic.strip_wrangler_types_from_build(content)).toBe(content)
	})

	it('is a no-op when no build script exists', () => {
		const content = JSON.stringify({ scripts: { [PREPARE_KEY]: SVELTE_KIT_SYNC } })

		expect(init_logic.strip_wrangler_types_from_build(content)).toBe(content)
	})
})

describe('merge_prepare_wrangler_types', () => {
	it('appends a guarded wrangler types to an existing prepare', () => {
		const content = JSON.stringify({ scripts: { [PREPARE_KEY]: SVELTE_KIT_SYNC } })
		const result = scripts_of(init_logic.merge_prepare_wrangler_types(content))

		expect(result[PREPARE_KEY]).toContain(SVELTE_KIT_SYNC)
		expect(result[PREPARE_KEY]).toContain(WRANGLER_TYPES)
		expect(result[PREPARE_KEY]).toContain(WRANGLER_GUARD)
		expect(result[PREPARE_KEY]).toContain('command -v wrangler >/dev/null 2>&1')
	})

	it('does not duplicate the command when it already runs in prepare', () => {
		const once = init_logic.merge_prepare_wrangler_types(
			JSON.stringify({ scripts: { [PREPARE_KEY]: SVELTE_KIT_SYNC } }),
		)

		expect(init_logic.merge_prepare_wrangler_types(once)).toBe(once)
	})

	it('is a no-op when no prepare script exists', () => {
		const content = JSON.stringify({ scripts: { [BUILD_KEY]: 'vite build' } })

		expect(init_logic.merge_prepare_wrangler_types(content)).toBe(content)
	})
})

describe('merge_prepare_wrangler_types transitive coverage', () => {
	it('is a no-op when prepare reaches wrangler types via a pnpm subscript chain', () => {
		expect(init_logic.merge_prepare_wrangler_types(APP_KIT_COVERED)).toBe(APP_KIT_COVERED)
	})

	it('still appends when a subscript chain never reaches wrangler types', () => {
		const content = JSON.stringify({
			scripts: { [PREPARE_KEY]: `pnpm ${PREPARE_GEN_KEY}`, [PREPARE_GEN_KEY]: SVELTE_KIT_SYNC },
		})
		const result = scripts_of(init_logic.merge_prepare_wrangler_types(content))

		expect(result[PREPARE_KEY]).toContain(PREPARE_GEN_KEY)
		expect(result[PREPARE_KEY]).toContain(WRANGLER_TYPES)
		expect(result[PREPARE_KEY]).toContain(WRANGLER_GUARD)
	})

	it('terminates and appends when pnpm references form a cycle', () => {
		const content = JSON.stringify({
			scripts: {
				[PREPARE_KEY]: `pnpm ${STEP_A_KEY}`,
				[STEP_A_KEY]: `pnpm ${STEP_B_KEY}`,
				[STEP_B_KEY]: `pnpm ${STEP_A_KEY}`,
			},
		})
		const result = scripts_of(init_logic.merge_prepare_wrangler_types(content))

		expect(result[PREPARE_KEY]).toContain(WRANGLER_TYPES)
		expect(result[PREPARE_KEY]).toContain(WRANGLER_GUARD)
	})

	it('is idempotent on a transitively-covered manifest', () => {
		const once = init_logic.merge_prepare_wrangler_types(APP_KIT_COVERED)

		expect(init_logic.merge_prepare_wrangler_types(once)).toBe(once)
	})
})

describe('migrate_wrangler_types_to_prepare', () => {
	const FROM = JSON.stringify({
		scripts: {
			[BUILD_KEY]: `${WRANGLER_TYPES} && ${VITE_BUILD}`,
			[PREPARE_KEY]: SVELTE_KIT_SYNC,
		},
	})

	it('moves wrangler types out of build and into prepare', () => {
		const result = scripts_of(init_logic.migrate_wrangler_types_to_prepare(FROM))

		expect(result[BUILD_KEY]).toBe(VITE_BUILD)
		expect(result[PREPARE_KEY]).toContain(WRANGLER_TYPES)
		expect(result[PREPARE_KEY]).toContain(WRANGLER_GUARD)
	})

	it('is idempotent on a second run', () => {
		const first = init_logic.migrate_wrangler_types_to_prepare(FROM)

		expect(init_logic.migrate_wrangler_types_to_prepare(first)).toBe(first)
	})
})

describe('prepare wrangler-guard exit-code behavior', () => {
	const EMPTY_PATH = ''

	it('exits zero when wrangler.jsonc is absent and tools are missing', () => {
		// Run in tmpdir (no wrangler.jsonc) so the guard `[ -f wrangler.jsonc ]` is false;
		// `|| true` then keeps the appended segment from failing the prepare chain.
		const migrated = init_logic.migrate_wrangler_types_to_prepare(
			JSON.stringify({ scripts: { [PREPARE_KEY]: 'true' } }),
		)

		expect(run_prepare(scripts_of(migrated)[PREPARE_KEY] ?? '', EMPTY_PATH, tmpdir())).toBe(0)
	})
})
