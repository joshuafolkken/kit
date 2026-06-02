import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

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

	it('ends with a true fallback so the hook exits zero when both guards skip', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[PREPARE]?.endsWith('; true')).toBe(true)
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
})
