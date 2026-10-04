import { describe, expect, it } from 'vitest'
import { claude_settings_fixture } from './claude-settings-fixture'

// The Artifact tool costs every call of a kit run about 12k tokens of context while no run uses
// it, so kit's own settings switch it off. The claude.ai connector switch was measured to change
// nothing in an interactive session and is deliberately absent. joshuafolkken/kit#3140
describe('.claude/settings.json — session context', () => {
	it('stops the Artifact tool from loading', () => {
		expect(claude_settings_fixture.load_settings().enableArtifact).toBe(false)
	})

	it('does not set the claude.ai connector switch, which measured no effect', () => {
		expect(claude_settings_fixture.read_settings_text()).not.toContain('disableClaudeAiConnectors')
	})
})
