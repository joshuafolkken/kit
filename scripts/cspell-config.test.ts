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

	// The root config imports the base dictionary, so anything listed in both is dead weight —
	// and a stale local copy hides the fact that the base dictionary owns the word, which is how
	// `backlink` and `jgame` ended up stranded on the non-distributed side (kit#730).
	it('holds only words the base dictionary does not already own', () => {
		const base_owned = new Set(load_words(BASE_DICTIONARY))

		expect(local_words.filter((word) => base_owned.has(word))).toEqual([])
	})
})
