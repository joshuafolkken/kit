import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { yaml_document } from '#scripts/yaml/yaml-document'
import { describe, expect, it } from 'vitest'
import { project_config } from './project-config'

const WORKSPACE =
	"minimumReleaseAgeExclude:\n  - vite\n  - '@types/node'\n  - tsx\n  - '@joshuafolkken/kit'\n"
const EXPECTED_EXCLUSIONS = ['vite', '@types/node', 'tsx', '@joshuafolkken/kit']
const REGISTRY = 'registry.example.com'

function exclusions(content: string): unknown {
	const aikido = yaml_document.parse_yaml(content)
	const safe_chain = aikido['safe-chain']
	if (!yaml_document.is_mapping_document(safe_chain)) throw new Error('safe-chain missing')
	const { npm } = safe_chain
	if (!yaml_document.is_mapping_document(npm)) throw new Error('safe-chain.npm missing')

	return npm['minimumPackageAgeExclusions']
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
		const workspace = readFileSync(new URL('../../pnpm-workspace.yaml', import.meta.url), 'utf8')
		const aikido = readFileSync(new URL('../../.aikido', import.meta.url), 'utf8')
		const source = yaml_document.parse_yaml(workspace)

		expect(exclusions(aikido)).toEqual(source['minimumReleaseAgeExclude'])
	})
})

describe('project_config.sync_project_config', () => {
	it('creates and updates the project config from a consumer workspace', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'safe-chain-config-'))
		const workspace_path = path.join(root, 'pnpm-workspace.yaml')
		const config_path = path.join(root, '.aikido')

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
