import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claude_plugin_config } from './claude-plugin-config'

const BASE_SETTINGS = JSON.stringify({ permissions: { deny: ['x'] }, hooks: {} }, undefined, '\t')
const SETTINGS_DESTINATION = path.join('/consumer', '.claude', 'settings.json')

interface PluginSettings {
	enabledPlugins?: Record<string, boolean>
	extraKnownMarketplaces?: Record<string, { source: { source: string; path: string } }>
	permissions?: { deny: ReadonlyArray<string> }
	hooks?: Record<string, unknown>
}

function parse(content: string): PluginSettings {
	return JSON.parse(content) as PluginSettings
}

describe('claude_plugin_config.inject_plugin_config', () => {
	it('enables the kit plugin and registers its marketplace', () => {
		const parsed = parse(claude_plugin_config.inject_plugin_config(BASE_SETTINGS))

		expect(parsed.enabledPlugins).toEqual({ [claude_plugin_config.PLUGIN_ID]: true })
		expect(parsed.extraKnownMarketplaces?.['kit']?.source).toEqual({
			source: 'directory',
			path: './node_modules/@joshuafolkken/kit',
		})
	})

	it('keeps the settings already in the file', () => {
		const parsed = parse(claude_plugin_config.inject_plugin_config(BASE_SETTINGS))

		expect(parsed.permissions).toEqual({ deny: ['x'] })
		expect(parsed.hooks).toEqual({})
	})
})

describe('claude_plugin_config.apply_plugin_config_for_destination', () => {
	it('injects into a .claude/settings.json destination', () => {
		const out = claude_plugin_config.apply_plugin_config_for_destination(
			SETTINGS_DESTINATION,
			BASE_SETTINGS,
		)

		expect(parse(out).enabledPlugins).toEqual({ [claude_plugin_config.PLUGIN_ID]: true })
	})

	it('leaves any other destination untouched', () => {
		const out = claude_plugin_config.apply_plugin_config_for_destination(
			path.join('/consumer', 'CLAUDE.md'),
			BASE_SETTINGS,
		)

		expect(out).toBe(BASE_SETTINGS)
	})
})
