import { yaml_config_fixture } from '#scripts/yaml/yaml-config-fixture'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const RELEASE_PATH = '.github/release.yml'
const LABELS = z.array(z.string())
const CATEGORY = z.object({ title: z.string(), labels: LABELS })
const CHANGELOG = z.object({
	exclude: z.object({ labels: LABELS }),
	categories: z.array(CATEGORY),
})
const RELEASE_CONFIG = z.object({ changelog: CHANGELOG })

describe('release note classification', () => {
	it('excludes ignored pull requests', () => {
		const config = RELEASE_CONFIG.parse(yaml_config_fixture.load_yaml_config(RELEASE_PATH))

		expect(config.changelog.exclude.labels).toContain('ignore-for-release')
	})

	it('orders breaking, features, fixes, and the catchall category', () => {
		const config = RELEASE_CONFIG.parse(yaml_config_fixture.load_yaml_config(RELEASE_PATH))

		expect(config.changelog.categories.map((category) => category.labels)).toEqual([
			['Semver-Major', 'breaking-change'],
			['Semver-Minor', 'enhancement'],
			['bugfix'],
			['*'],
		])
	})
})
