import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const SONAR_TEMPLATE = 'sonar.projectKey={{PROJECT_KEY}}\nsonar.organization={{ORGANIZATION}}\n'
const REPO_NAME = 'joshuafolkken/myapp'
const PROJECT_KEY = 'joshuafolkken_myapp'
const ORGANIZATION = 'joshuafolkken'

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

		expect(init_logic.apply_sonar_template(template, 'a_b', 'a')).toContain(
			'sonar.exclusions=.claude/**',
		)
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
