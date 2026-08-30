import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { yaml_config_fixture } from './yaml-config-fixture'

interface CspellConfig {
	words?: Array<string>
	ignorePaths?: Array<string>
}

const BASE_DICTIONARY = path.join('cspell', 'index.yaml')
const KIT_CSPELL_CONFIG = 'cspell.config.yaml'
const WORKTREE_DIRECTORY = '.claude/worktrees'
const WORKTREE_GLOB = `**/${WORKTREE_DIRECTORY}/**`

function load_words(relative_path: string): Array<string> {
	const config = yaml_config_fixture.load_yaml_config(relative_path) as CspellConfig

	return config.words ?? []
}

function load_ignore_paths(relative_path: string): Array<string> {
	const config = yaml_config_fixture.load_yaml_config(relative_path) as CspellConfig

	return config.ignorePaths ?? []
}

describe('cspell/index.yaml base dictionary', () => {
	const base_words = load_words(BASE_DICTIONARY)

	it('allows the SonarQube keyword from kit-generated sonar-project.properties', () => {
		expect(base_words).toContain('multicriteria')
	})
})

// joshuafolkken/kit#1114: `useGitignore` reads `.gitignore`, and git excludes a bridge work tree
// through `.git/info/exclude` instead — a per-checkout file that is never committed and that nothing
// outside git reads. Measured with one present: the scan covered 1,558 files, of which 778 were the
// work tree's, and a misspelling planted in one of them failed the check on the current branch.
describe('cspell/index.yaml ignores nested checkouts', () => {
	const ignore_paths = load_ignore_paths(BASE_DICTIONARY)

	it('excludes a bridge work tree at any depth', () => {
		expect(ignore_paths).toContain(WORKTREE_GLOB)
	})

	// A monorepo puts a package's work trees under it, so a root-anchored pattern would scan them.
	// Asserted against what the file actually holds: a `.claude/worktrees/**` written without the
	// prefix reads as a fix and covers only the root, which is the regression this pins.
	it('anchors the exclusion nowhere', () => {
		const worktree_entries = ignore_paths.filter((entry) => entry.includes(WORKTREE_DIRECTORY))

		expect(worktree_entries).toStrictEqual([WORKTREE_GLOB])
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
