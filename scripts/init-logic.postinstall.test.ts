import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const FIX_GH_PACKAGES_CMD = 'tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'
const FIX_GH_PACKAGES_MARKER = 'fix-gh-packages'
const LEFTHOOK_INSTALL = 'lefthook install'
const POSTINSTALL = 'postinstall'
const VANILLA = 'vanilla'

describe('get_suggested_scripts postinstall value', () => {
	it('includes fix-gh-packages command in postinstall', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[POSTINSTALL]).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('includes lefthook install in postinstall', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[POSTINSTALL]).toContain(LEFTHOOK_INSTALL)
	})

	it('guards lefthook so a missing binary does not abort install', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[POSTINSTALL]).toContain('command -v lefthook >/dev/null 2>&1 && lefthook install')
	})

	it('guards tsx so a missing binary does not abort install', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[POSTINSTALL]).toContain('command -v tsx >/dev/null 2>&1')
	})

	it('ends with a true fallback so the hook exits zero when both guards skip', () => {
		const result = init_logic.get_suggested_scripts(VANILLA)

		expect(result[POSTINSTALL]?.endsWith('; true')).toBe(true)
	})
})

describe('get_suggested_scripts_for_content postinstall skip', () => {
	it('omits postinstall when a script already runs fix-gh-packages', () => {
		const content = JSON.stringify({
			scripts: { prepare: `command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true` },
		})

		const result = init_logic.get_suggested_scripts_for_content(VANILLA, content)

		expect(result).not.toHaveProperty(POSTINSTALL)
	})

	it('keeps postinstall when no script runs fix-gh-packages', () => {
		const content = JSON.stringify({ scripts: { prepare: 'svelte-kit sync' } })

		const result = init_logic.get_suggested_scripts_for_content(VANILLA, content)

		expect(result).toHaveProperty(POSTINSTALL)
	})
})

describe('merge_sveltekit_package_json postinstall idempotency', () => {
	it('does not add a postinstall when prepare already runs fix-gh-packages', () => {
		const content = JSON.stringify({
			scripts: { prepare: `command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true` },
		})
		const result = JSON.parse(init_logic.merge_sveltekit_package_json(content)) as {
			scripts: Record<string, string>
		}

		expect(result.scripts).not.toHaveProperty(POSTINSTALL)
	})
})

describe('merge_postinstall_fix_cmd', () => {
	it('appends fix cmd to existing postinstall that lacks it', () => {
		const content = JSON.stringify({ scripts: { [POSTINSTALL]: LEFTHOOK_INSTALL } })
		const result = JSON.parse(init_logic.merge_postinstall_fix_cmd(content)) as {
			scripts: Record<string, string>
		}

		expect(result.scripts[POSTINSTALL]).toContain(FIX_GH_PACKAGES_MARKER)
	})

	it('returns content unchanged when fix cmd already present', () => {
		const content = JSON.stringify({
			scripts: { [POSTINSTALL]: `lefthook install && ${FIX_GH_PACKAGES_CMD}` },
		})

		expect(init_logic.merge_postinstall_fix_cmd(content)).toBe(content)
	})

	it('returns content unchanged when no postinstall script exists', () => {
		const content = JSON.stringify({ scripts: {} })

		expect(init_logic.merge_postinstall_fix_cmd(content)).toBe(content)
	})

	it('returns content unchanged when another script already runs fix-gh-packages', () => {
		const content = JSON.stringify({
			scripts: {
				[POSTINSTALL]: LEFTHOOK_INSTALL,
				prepare: `command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}; true`,
			},
		})

		expect(init_logic.merge_postinstall_fix_cmd(content)).toBe(content)
	})
})
