import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

const SONAR_TEMPLATE = 'sonar.projectKey={{PROJECT_KEY}}\nsonar.organization={{ORGANIZATION}}\n'
const REPO_NAME = 'joshuafolkken/myapp'
const PROJECT_KEY = 'joshuafolkken_myapp'
const ORGANIZATION = 'joshuafolkken'
const SONAR_EXCLUSIONS_LINE = 'sonar.exclusions=.claude/**'
const EXISTING = 'sonar.projectKey=org_repo\nsonar.organization=org\n'

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

describe('merge_sonar_properties multicriteria exclusions', () => {
	it('activates new template exclusions while preserving custom IDs and values', () => {
		const existing = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e2,e3,e4,e5,custom\nsonar.issue.ignore.multicriteria.e1.ruleKey=custom:rule\nsonar.issue.ignore.multicriteria.e1.resourceKey=custom/**\n`
		const template = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e2,e3,e4,e5,e6,e7,e8\nsonar.issue.ignore.multicriteria.e1.ruleKey=template:rule\nsonar.issue.ignore.multicriteria.e1.resourceKey=scripts/**\nsonar.issue.ignore.multicriteria.e6.ruleKey=typescript:S8707\nsonar.issue.ignore.multicriteria.e7.ruleKey=javascript:S8707\nsonar.issue.ignore.multicriteria.e8.ruleKey=jssecurity:S8707\n`
		const result = init_logic.merge_sonar_properties(existing, template)

		expect(result).toContain('sonar.issue.ignore.multicriteria=e1,e2,e3,e4,e5,custom,e9,e6,e7,e8\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e1.ruleKey=custom:rule\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e9.ruleKey=template:rule\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e9.resourceKey=scripts/**\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e6.ruleKey=typescript:S8707\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e7.ruleKey=javascript:S8707\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e8.ruleKey=jssecurity:S8707\n')
	})

	it('keeps exclusion IDs unique and stable across repeated syncs', () => {
		const existing = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e2\n`
		const template = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e2,e3\nsonar.issue.ignore.multicriteria.e3.ruleKey=rule\n`
		const merged = init_logic.merge_sonar_properties(existing, template)

		expect(merged).toContain('sonar.issue.ignore.multicriteria=e1,e2,e3\n')
		expect(init_logic.merge_sonar_properties(merged, template)).toBe(merged)
	})

	it('uses the template exclusion list when the existing list is empty', () => {
		const existing = `${EXISTING}sonar.issue.ignore.multicriteria=\n`
		const template = `${EXISTING}sonar.issue.ignore.multicriteria=e1\n`

		expect(init_logic.merge_sonar_properties(existing, template)).toContain(
			'sonar.issue.ignore.multicriteria=e1\n',
		)
	})
})

describe('merge_sonar_properties multicriteria edge cases', () => {
	it('activates new IDs when the existing list contains duplicates', () => {
		const existing = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e1\n`
		const template = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e2\nsonar.issue.ignore.multicriteria.e2.ruleKey=rule\n`

		expect(init_logic.merge_sonar_properties(existing, template)).toContain(
			'sonar.issue.ignore.multicriteria=e1,e2\n',
		)
	})

	it('allocates a new ID when a template criterion conflicts with a custom criterion', () => {
		const existing = `${EXISTING}sonar.issue.ignore.multicriteria=e5\nsonar.issue.ignore.multicriteria.e5.ruleKey=custom:rule\nsonar.issue.ignore.multicriteria.e5.resourceKey=custom/**\n`
		const template = `${EXISTING}sonar.issue.ignore.multicriteria=e5,e6\nsonar.issue.ignore.multicriteria.e5.ruleKey=template:rule\nsonar.issue.ignore.multicriteria.e5.resourceKey=scripts/**\nsonar.issue.ignore.multicriteria.e6.ruleKey=other:rule\nsonar.issue.ignore.multicriteria.e6.resourceKey=other/**\n`
		const result = init_logic.merge_sonar_properties(existing, template)

		expect(result).toContain('sonar.issue.ignore.multicriteria=e5,e7,e6\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e5.ruleKey=custom:rule\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e7.ruleKey=template:rule\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e7.resourceKey=scripts/**\n')
		expect(init_logic.merge_sonar_properties(result, template)).toBe(result)
	})

	it('activates the new criteria in the distributed Sonar template', () => {
		const template = readFileSync(
			new URL('../../templates/sonar-project.properties', import.meta.url),
			'utf8',
		)
		const existing = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e2,e3,e4,e5\n`
		const result = init_logic.merge_sonar_properties(existing, template)

		for (const id of ['e6', 'e7', 'e8']) {
			expect(result).toContain(`sonar.issue.ignore.multicriteria.${id}.ruleKey=`)
			expect(result).toContain(`sonar.issue.ignore.multicriteria.${id}.resourceKey=`)
		}

		expect(result).toContain('sonar.issue.ignore.multicriteria=e1,e2,e3,e4,e5,e6,e7,e8\n')
	})
})

describe('merge_sonar_properties template ID conflicts', () => {
	it('does not reuse an ID assigned to another template criterion', () => {
		const existing = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e5\nsonar.issue.ignore.multicriteria.e1.ruleKey=custom:rule\nsonar.issue.ignore.multicriteria.e1.resourceKey=custom/**\nsonar.issue.ignore.multicriteria.e5.ruleKey=template:A\nsonar.issue.ignore.multicriteria.e5.resourceKey=a/**\n`
		const template = `${EXISTING}sonar.issue.ignore.multicriteria=e1,e5\nsonar.issue.ignore.multicriteria.e1.ruleKey=template:A\nsonar.issue.ignore.multicriteria.e1.resourceKey=a/**\nsonar.issue.ignore.multicriteria.e5.ruleKey=template:B\nsonar.issue.ignore.multicriteria.e5.resourceKey=b/**\n`
		const result = init_logic.merge_sonar_properties(existing, template)

		expect(result).toContain('sonar.issue.ignore.multicriteria=e1,e5,e6,e7\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e6.ruleKey=template:A\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e7.ruleKey=template:B\n')
		expect(result).toContain('sonar.issue.ignore.multicriteria.e7.resourceKey=b/**\n')
		expect(init_logic.merge_sonar_properties(result, template)).toBe(result)
	})
})
