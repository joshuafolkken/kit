import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SONAR_PROPERTIES_FILE = 'sonar-project.properties'
const SONAR_TEMPLATE_FILE = 'templates/sonar-project.properties'

function load_sonar_properties(file = SONAR_PROPERTIES_FILE): Record<string, string> {
	const content = readFileSync(path.resolve(process.cwd(), file), 'utf8')
	const entries = content
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'))
		.map((line): [string, string] => {
			const index = line.indexOf('=')
			const key = line.slice(0, index).trim()
			const value = line.slice(index + 1).trim()

			return [key, value]
		})

	return Object.fromEntries(entries)
}

describe(SONAR_PROPERTIES_FILE, () => {
	const properties = load_sonar_properties()
	const exclusions = (properties['sonar.exclusions'] ?? '').split(',').map((entry) => entry.trim())

	it('excludes upstream-synced .claude bootstrap scripts from analysis', () => {
		expect(exclusions).toContain('.claude/**')
	})

	it('does not exclude scripts/ core package code from analysis', () => {
		expect(exclusions).not.toContain('scripts/**')
	})

	// joshuafolkken/kit#2903 moved the `scripts-ai/` entry points under `scripts/`, so its own
	// suppressions went with it.
	it('suppresses the S4036 OS-command hotspot on scripts/ alone via issue.ignore', () => {
		const rule_keys = Object.entries(properties)
			.filter(([key]) => key.endsWith('.ruleKey'))
			.map(([, value]) => value)
		const resource_keys = Object.entries(properties)
			.filter(([key]) => key.endsWith('.resourceKey'))
			.map(([, value]) => value)

		expect(rule_keys).toContain('typescript:S4036')
		expect(resource_keys).toContain('scripts/**/*')
		expect(resource_keys).not.toContain('scripts-ai/**/*')
	})
})

// joshuafolkken/kit#5073: declaring the test files as tests (#5072) cut the taint analysis by about 27s
// on a pull request, not on main, and the SonarQube job still finished after CI, so it was reverted.
describe(`${SONAR_PROPERTIES_FILE} test files`, () => {
	const properties = load_sonar_properties()
	const exclusions = (properties['sonar.exclusions'] ?? '').split(',').map((entry) => entry.trim())

	it('keeps the test files in the main sources rather than declaring them as tests', () => {
		expect(exclusions).not.toContain('**/*.test.ts')
		expect(exclusions).not.toContain('**/*.spec.ts')
		expect(exclusions).not.toContain('**/*.e2e.ts')
		expect(properties['sonar.tests']).toBeUndefined()
		expect(properties['sonar.test.inclusions']).toBeUndefined()
	})
})

// joshuafolkken/kit#5084: the new taint engine re-analyzes every file on any change; the legacy one
// keeps a per-file cache, and the taint rules stay on.
describe(`${SONAR_PROPERTIES_FILE} taint engine`, () => {
	const properties = load_sonar_properties()

	it('runs the taint analysis on the legacy engine', () => {
		expect(properties['sonar.jasmin.internal.disabled']).toBe('true')
	})

	it('keeps the taint rules analyzed on every file', () => {
		const prefix = 'sonar.issue.ignore.multicriteria'
		const muted_everywhere = (properties[prefix] ?? '')
			.split(',')
			.filter((id) => properties[`${prefix}.${id}.resourceKey`] === '**/*')
			.map((id) => properties[`${prefix}.${id}.ruleKey`] ?? '')

		expect(muted_everywhere.filter((rule) => /^(?:ts|js)security:/u.test(rule))).toEqual([])
	})
})

// joshuafolkken/kit#3047: ESLint's `no-await-in-loop` is the gate for S9382, and SonarJS does not read
// the `eslint-disable-next-line` comments that record each intentional sequential await.
describe.each([SONAR_PROPERTIES_FILE, SONAR_TEMPLATE_FILE])('%s S9382 suppression', (file) => {
	const properties = load_sonar_properties(file)
	const criteria = (properties['sonar.issue.ignore.multicriteria'] ?? '').split(',')

	it.each(['typescript', 'javascript'])('mutes %s:S9382 over every file', (language) => {
		const rule = `${language}:S9382`
		const id = criteria.find(
			(entry) => properties[`sonar.issue.ignore.multicriteria.${entry}.ruleKey`] === rule,
		)

		expect(id).toBeDefined()
		expect(properties[`sonar.issue.ignore.multicriteria.${String(id)}.resourceKey`]).toBe('**/*')
	})
})
