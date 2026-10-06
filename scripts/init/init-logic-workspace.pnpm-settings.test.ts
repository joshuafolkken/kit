import { readFileSync } from 'node:fs'
import { yaml_document } from '#scripts/lib/yaml-document'
import { describe, expect, it } from 'vitest'
import { init_logic_workspace } from './init-logic-workspace'

// pnpm 12 reads the release-age window and the engine check from `pnpm-workspace.yaml` only, so
// both workspace files kit distributes declare them there rather than in `.npmrc` (kit#3267).
const DAY_MINUTES = 1440
const CONSUMER_WORKSPACE = 'packages:\n  - app\n'
const WORKSPACE_SOURCES: ReadonlyArray<string> = [
	'pnpm-workspace.yaml',
	'templates/pnpm-workspace.basic.yaml',
]

function settings_of(content: string): unknown {
	return yaml_document.parse_yaml(content)
}

describe.each(WORKSPACE_SOURCES)('%s — pnpm settings', (source) => {
	const template = readFileSync(source, 'utf8')

	it('declares a one-day minimumReleaseAge and engineStrict', () => {
		expect(settings_of(template)).toMatchObject({
			minimumReleaseAge: DAY_MINUTES,
			engineStrict: true,
		})
	})

	it('adds both settings to a consumer workspace that lacks them', () => {
		const merged = init_logic_workspace.merge_workspace_yaml(CONSUMER_WORKSPACE, template)

		expect(settings_of(merged)).toMatchObject({
			packages: ['app'],
			minimumReleaseAge: DAY_MINUTES,
			engineStrict: true,
		})
	})

	it('keeps a consumer-chosen window rather than overwriting it', () => {
		const existing = `${CONSUMER_WORKSPACE}minimumReleaseAge: 4320\n`
		const merged = init_logic_workspace.merge_workspace_yaml(existing, template)

		expect(settings_of(merged)).toMatchObject({ minimumReleaseAge: 4320 })
	})
})

// A project's own `.npmrc` value is moved, not replaced by kit's default (kit#3267).
describe.each(WORKSPACE_SOURCES)('%s — carried .npmrc settings', (source) => {
	const template = readFileSync(source, 'utf8')

	it('carries a project .npmrc window and engine check into a workspace that lacks them', () => {
		const npmrc = 'minimum-release-age=4320\nengine-strict = false\n'
		const carried = init_logic_workspace.carry_npmrc_settings(template, npmrc)
		const merged = init_logic_workspace.merge_workspace_yaml(CONSUMER_WORKSPACE, carried)

		expect(settings_of(merged)).toMatchObject({ minimumReleaseAge: 4320, engineStrict: false })
	})

	it('lets a workspace-declared window win over the .npmrc one', () => {
		const carried = init_logic_workspace.carry_npmrc_settings(template, 'minimum-release-age=60\n')
		const existing = `${CONSUMER_WORKSPACE}minimumReleaseAge: 4320\n`
		const merged = init_logic_workspace.merge_workspace_yaml(existing, carried)

		expect(settings_of(merged)).toMatchObject({ minimumReleaseAge: 4320 })
	})

	it('takes the last .npmrc assignment, as npm does', () => {
		const npmrc = 'minimum-release-age=60\nminimum-release-age=4320\n'

		expect(settings_of(init_logic_workspace.carry_npmrc_settings(template, npmrc))).toMatchObject({
			minimumReleaseAge: 4320,
		})
	})

	it('keeps the template values when .npmrc declares nothing usable', () => {
		const npmrc = '# minimum-release-age=60\nminimum-release-age=soon\nengine-strict=maybe\n'

		expect(init_logic_workspace.carry_npmrc_settings(template, npmrc)).toBe(template)
	})
})
