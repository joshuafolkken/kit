import { readFileSync } from 'node:fs'
import path from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface CspellConfig {
	words?: Array<string>
}

const BASE_DICTIONARY = path.join('cspell', 'index.yaml')
const KIT_CSPELL_CONFIG = 'cspell.config.yaml'

function load_words(relative_path: string): Array<string> {
	const content = readFileSync(path.resolve(process.cwd(), relative_path), 'utf8')
	const config = load(content) as CspellConfig

	return config.words ?? []
}

describe('cspell/index.yaml base dictionary', () => {
	const base_words = load_words(BASE_DICTIONARY)

	it('allows the SonarQube keyword from kit-generated sonar-project.properties', () => {
		expect(base_words).toContain('multicriteria')
	})
})

describe('cspell.config.yaml local words', () => {
	const local_words = load_words(KIT_CSPELL_CONFIG)

	it('does not duplicate multicriteria now that the base dictionary owns it', () => {
		expect(local_words).not.toContain('multicriteria')
	})
})
