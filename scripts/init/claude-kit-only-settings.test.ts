import path from 'node:path'
import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { describe, expect, it } from 'vitest'
import { claude_kit_only_settings } from './claude-kit-only-settings'
import { transform_copied_content } from './init-copy-content'

const SETTINGS_DESTINATION = path.join('/consumer', '.claude', 'settings.json')
const OTHER_DESTINATION = path.join('/consumer', 'CLAUDE.md')
const KIT_SETTINGS = JSON.stringify(
	{ permissions: { deny: ['x'] }, enableArtifact: false, hooks: {} },
	undefined,
	'\t',
)

function parse(content: string): Record<string, unknown> {
	return JSON.parse(content) as Record<string, unknown>
}

describe('claude_kit_only_settings.strip_kit_only_settings', () => {
	it('removes enableArtifact and keeps every other key', () => {
		const stripped = parse(claude_kit_only_settings.strip_kit_only_settings(KIT_SETTINGS))

		expect(stripped).not.toHaveProperty('enableArtifact')
		expect(stripped).toEqual({ permissions: { deny: ['x'] }, hooks: {} })
	})
})

describe('claude_kit_only_settings.apply_kit_only_strip_for_destination', () => {
	it('strips a .claude/settings.json destination', () => {
		const result = claude_kit_only_settings.apply_kit_only_strip_for_destination(
			SETTINGS_DESTINATION,
			KIT_SETTINGS,
		)

		expect(parse(result)).not.toHaveProperty('enableArtifact')
	})

	it('leaves any other destination untouched', () => {
		expect(
			claude_kit_only_settings.apply_kit_only_strip_for_destination(
				OTHER_DESTINATION,
				KIT_SETTINGS,
			),
		).toBe(KIT_SETTINGS)
	})
})

describe('transform_copied_content — kit-only settings', () => {
	it('ships kit settings to a consumer without any kit-only key', () => {
		const shipped = parse(
			transform_copied_content(SETTINGS_DESTINATION, claude_settings_fixture.read_settings_text()),
		)

		for (const key of claude_kit_only_settings.KIT_ONLY_SETTING_KEYS) {
			expect(shipped).not.toHaveProperty(key)
		}
	})
})
