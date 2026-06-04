import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const SONAR_TEMPLATE = 'sonar.projectKey={{PROJECT_KEY}}\nsonar.organization={{ORGANIZATION}}\n'
const REPO_NAME = 'joshuafolkken/myapp'
const PROJECT_KEY = 'joshuafolkken_myapp'
const ORGANIZATION = 'joshuafolkken'
const SONAR_EXCLUSIONS_LINE = 'sonar.exclusions=.claude/**'

describe('apply_sonar_template', () => {
	it('replaces PROJECT_KEY placeholder with given project key', () => {
		expect(init_logic.apply_sonar_template(SONAR_TEMPLATE, PROJECT_KEY, ORGANIZATION)).toContain(
			`sonar.projectKey=${PROJECT_KEY}`,
		)
	})

	it('replaces ORGANIZATION placeholder with given organization', () => {
		expect(init_logic.apply_sonar_template(SONAR_TEMPLATE, PROJECT_KEY, ORGANIZATION)).toContain(
			`sonar.organization=${ORGANIZATION}`,
		)
	})

	it('leaves unrelated lines unchanged', () => {
		const template = `${SONAR_TEMPLATE}sonar.exclusions=.claude/**\n`

		expect(init_logic.apply_sonar_template(template, 'a_b', 'a')).toContain(SONAR_EXCLUSIONS_LINE)
	})
})

describe('derive_sonar_identifiers', () => {
	it('derives project_key by replacing slash with underscore', () => {
		expect(init_logic.derive_sonar_identifiers(REPO_NAME).project_key).toBe(PROJECT_KEY)
	})

	it('derives organization from owner part before slash', () => {
		expect(init_logic.derive_sonar_identifiers(REPO_NAME).organization).toBe(ORGANIZATION)
	})

	it('throws on malformed input with no slash', () => {
		expect(() => init_logic.derive_sonar_identifiers('noslash')).toThrow()
	})

	it('throws on malformed input with extra path segments', () => {
		expect(() => init_logic.derive_sonar_identifiers('owner/repo/extra')).toThrow()
	})
})

describe('get_sonar_template_source', () => {
	it('returns the template source path', () => {
		expect(init_logic.get_sonar_template_source()).toBe('templates/sonar-project.properties')
	})
})

describe('get_sonar_template_destination', () => {
	it('returns sonar-project.properties', () => {
		expect(init_logic.get_sonar_template_destination()).toBe('sonar-project.properties')
	})
})

describe('merge_sonar_properties', () => {
	const EXISTING = 'sonar.projectKey=org_repo\nsonar.organization=org\n'
	const TEMPLATE_CONTENT =
		'sonar.projectKey=org_repo\nsonar.organization=org\nsonar.exclusions=.claude/**\n'

	it('returns existing unchanged when all template keys already present', () => {
		expect(init_logic.merge_sonar_properties(EXISTING, EXISTING)).toBe(EXISTING)
	})

	it('appends missing key from template to existing content', () => {
		const result = init_logic.merge_sonar_properties(EXISTING, TEMPLATE_CONTENT)

		expect(result).toContain(SONAR_EXCLUSIONS_LINE)
	})

	it('preserves existing key values when merging', () => {
		const result = init_logic.merge_sonar_properties(EXISTING, TEMPLATE_CONTENT)

		expect(result).toContain('sonar.projectKey=org_repo')
		expect(result).toContain('sonar.organization=org')
	})

	it('does not duplicate keys already in existing', () => {
		const result = init_logic.merge_sonar_properties(EXISTING, TEMPLATE_CONTENT)
		const count = (result.match(/sonar\.projectKey=/gu) ?? []).length

		expect(count).toBe(1)
	})

	it('skips comment lines when determining keys to add', () => {
		const template_with_comment = `${EXISTING}# a comment\nsonar.newKey=val\n`
		const result = init_logic.merge_sonar_properties(EXISTING, template_with_comment)

		expect(result).toContain('sonar.newKey=val')
		expect(result).not.toContain('# a comment\n# a comment')
	})
})
