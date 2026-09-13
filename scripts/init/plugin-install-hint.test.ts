import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { plugin_install_hint_module } from './plugin-install-hint'

const { is_plugin_installed, plugin_install_hint } = plugin_install_hint_module
const TEMP_PREFIX = 'plugin-hint-'

describe('plugin_install_hint', () => {
	it('returns the install command when the plugin is not installed', () => {
		expect(plugin_install_hint(false)).toContain('claude plugin install kit@kit')
	})

	it('returns nothing when the plugin is already installed', () => {
		expect(plugin_install_hint(true)).toBeUndefined()
	})
})

describe('is_plugin_installed', () => {
	it('is false when no claude plugins directory exists', () => {
		const home = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))

		expect(is_plugin_installed(home)).toBe(false)
	})

	it('is true when the kit marketplace directory is present', () => {
		const home = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX))

		mkdirSync(path.join(home, '.claude', 'plugins', 'kit'), { recursive: true })

		expect(is_plugin_installed(home)).toBe(true)
	})
})
