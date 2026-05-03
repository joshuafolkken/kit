import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SONAR_PROPERTIES_FILE = 'sonar-project.properties'

function load_sonar_properties(): Record<string, string> {
	const content = readFileSync(path.resolve(process.cwd(), SONAR_PROPERTIES_FILE), 'utf8')
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

	it('does not exclude scripts-ai/ from analysis', () => {
		expect(exclusions).not.toContain('scripts-ai/**')
	})

	it('does not exclude scripts/ core package code from analysis', () => {
		expect(exclusions).not.toContain('scripts/**')
	})
})
