import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { yaml_document } from '#scripts/lib/yaml-document'
import { release_age } from '#scripts/version/release-age'
import { describe, expect, it } from 'vitest'
import { project_config } from './project-config'

const WORKSPACE =
	"minimumReleaseAgeExclude:\n  - vite\n  - '@types/node'\n  - tsx\n  - '@joshuafolkken/kit'\n"
const EXPECTED_EXCLUSIONS = ['vite', '@types/node', 'tsx', '@joshuafolkken/kit']
const REGISTRY = 'registry.example.com'
const WORKSPACE_DAY = `${WORKSPACE}minimumReleaseAge: 1440\n`
const WORKSPACE_PARTIAL_HOUR = `${WORKSPACE}minimumReleaseAge: 1470\n`
const WORKSPACE_OPT_OUT = `${WORKSPACE}minimumReleaseAge: 0\n`
const DAY_HOURS = 24
const MINUTES_PER_HOUR = 60
const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const AIKIDO_FILE = '.aikido'

function read_safe_chain(content: string): Record<string, unknown> {
	const safe_chain = yaml_document.parse_yaml(content)['safe-chain']
	if (!yaml_document.is_mapping_document(safe_chain)) throw new Error('safe-chain missing')

	return safe_chain
}

function read_kit_file(name: string): string {
	return readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')
}

function exclusions(content: string): unknown {
	const { npm } = read_safe_chain(content)
	if (!yaml_document.is_mapping_document(npm)) throw new Error('safe-chain.npm missing')

	return npm['minimumPackageAgeExclusions']
}

function age_hours(content: string): unknown {
	return read_safe_chain(content)['minimumPackageAgeHours']
}

describe('project_config.merge_project_config', () => {
	it('mirrors the pnpm exclusions, including scoped packages', () => {
		const result = project_config.merge_project_config('', WORKSPACE)

		expect(exclusions(result)).toEqual(EXPECTED_EXCLUSIONS)
	})

	it('preserves unrelated Aikido settings and replaces stale age exclusions', () => {
		const unrelated = '# Keep this comment and anchor\nother-tool: &other\n  enabled: true\n\n'
		const suffix = 'another-tool: *other\n'
		const existing = `${unrelated}safe-chain:\n  npm:\n    customRegistries:\n      - ${REGISTRY}\n    minimumPackageAgeExclusions:\n      - old\n${suffix}`
		const result = project_config.merge_project_config(existing, WORKSPACE)
		const parsed = yaml_document.parse_yaml(result)

		expect(result.startsWith(unrelated)).toBe(true)
		expect(result.endsWith(suffix)).toBe(true)
		expect(parsed['other-tool']).toEqual({ enabled: true })
		expect(parsed['safe-chain']).toMatchObject({
			npm: { customRegistries: [REGISTRY] },
		})
		expect(exclusions(result)).toEqual(EXPECTED_EXCLUSIONS)
	})

	it('leaves a synchronized file byte-for-byte unchanged', () => {
		const existing = project_config.merge_project_config('', WORKSPACE)

		expect(project_config.merge_project_config(existing, WORKSPACE)).toBe(existing)
	})

	it('updates a quoted safe-chain key without adding a duplicate', () => {
		const existing = "'safe-chain':\n  npm:\n    minimumPackageAgeExclusions:\n      - old\n"
		const result = project_config.merge_project_config(existing, WORKSPACE)

		expect(result.match(/safe-chain/gu)).toHaveLength(1)
		expect(exclusions(result)).toEqual(EXPECTED_EXCLUSIONS)
	})
})

describe('project_config.merge_project_config — minimum package age', () => {
	it('converts the workspace window from minutes to whole hours', () => {
		const result = project_config.merge_project_config('', WORKSPACE_DAY)

		expect(age_hours(result)).toBe(DAY_HOURS)
	})

	it('floors a partial hour so Safe Chain is never stricter than pnpm', () => {
		const result = project_config.merge_project_config('', WORKSPACE_PARTIAL_HOUR)

		expect(age_hours(result)).toBe(DAY_HOURS)
	})

	it('writes 0 for an explicit opt-out, replacing an earlier synchronized age', () => {
		const existing = project_config.merge_project_config('', WORKSPACE_DAY)
		const result = project_config.merge_project_config(existing, WORKSPACE_OPT_OUT)

		expect(age_hours(result)).toBe(0)
	})

	it('writes no age when the workspace declares no window', () => {
		const result = project_config.merge_project_config('', WORKSPACE)

		expect(age_hours(result)).toBeUndefined()
	})

	it('replaces a stale age and is stable once synchronized', () => {
		const existing = project_config.merge_project_config(
			'',
			`${WORKSPACE}minimumReleaseAge: 2880\n`,
		)
		const result = project_config.merge_project_config(existing, WORKSPACE_DAY)

		expect(age_hours(result)).toBe(DAY_HOURS)
		expect(project_config.merge_project_config(result, WORKSPACE_DAY)).toBe(result)
	})
})

describe('project_config.merge_project_config — YAML structure', () => {
	it('keeps a safe-chain anchor referenced by another setting', () => {
		const existing =
			'safe-chain: &scanner\n  npm:\n    minimumPackageAgeExclusions:\n      - old\nother-tool: *scanner\n'
		const result = project_config.merge_project_config(existing, WORKSPACE)
		const parsed = yaml_document.parse_yaml(result)

		expect(result).toContain('safe-chain: &scanner')
		expect(parsed['other-tool']).toEqual(parsed['safe-chain'])
		expect(exclusions(result)).toEqual(EXPECTED_EXCLUSIONS)
	})

	it('absorbs a column-zero comment between safe-chain settings', () => {
		const existing =
			'safe-chain:\n  npm:\n    minimumPackageAgeExclusions:\n      - old\n# explanation\n    customRegistries:\n      - registry.example.com\nother-tool: true\n'
		const result = project_config.merge_project_config(existing, WORKSPACE)
		const parsed = yaml_document.parse_yaml(result)

		expect(parsed['safe-chain']).toMatchObject({
			npm: { customRegistries: [REGISTRY] },
		})
		expect(parsed['other-tool']).toBe(true)
		expect(exclusions(result)).toEqual(EXPECTED_EXCLUSIONS)
	})
})

describe('kit project configuration', () => {
	it('matches the kit workspace exclusion list', () => {
		const workspace = read_kit_file(WORKSPACE_FILE)
		const aikido = read_kit_file(AIKIDO_FILE)
		const source = yaml_document.parse_yaml(workspace)

		expect(exclusions(aikido)).toEqual(source['minimumReleaseAgeExclude'])
	})

	// `tsx` runs every `josh` command, so a fresh release of it waits out the window like any other
	// dependency; only vite, whose security fixes ship same-day, skips it (kit #3602).
	it('excludes only vite from the release-age window', () => {
		const source = yaml_document.parse_yaml(read_kit_file(WORKSPACE_FILE))

		expect(source['minimumReleaseAgeExclude']).toStrictEqual(['vite'])
	})

	it('matches the Safe Chain minimum age to the workspace window', () => {
		const minutes = release_age.parse_minimum_release_age(read_kit_file(WORKSPACE_FILE))
		const aikido = read_kit_file(AIKIDO_FILE)

		expect(minutes).toBeGreaterThan(0)
		expect(age_hours(aikido)).toBe(Math.floor(minutes / MINUTES_PER_HOUR))
	})
})

describe('project_config.sync_project_config', () => {
	it('creates and updates the project config from a consumer workspace', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'safe-chain-config-'))
		const workspace_path = path.join(root, WORKSPACE_FILE)
		const config_path = path.join(root, AIKIDO_FILE)

		try {
			writeFileSync(workspace_path, WORKSPACE)
			expect(project_config.sync_project_config(root)).toBe(true)
			expect(exclusions(readFileSync(config_path, 'utf8'))).toEqual(EXPECTED_EXCLUSIONS)
			expect(project_config.sync_project_config(root)).toBe(false)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})
})
