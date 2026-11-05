import { describe, expect, it } from 'vitest'
import { review_level } from './review-level'

const CODE = 'scripts/review/review-level.ts'
const EDITOR_SETTING = '.editorconfig'
const RULES_DOCUMENT = 'CLAUDE.md'

describe('review_level.level_for', () => {
	it.each([0, 1, 20])('reduces executable changes of %i lines (ac-df3ca1fc)', (lines) => {
		expect(review_level.level_for([CODE], lines)).toBe(review_level.REDUCED_LEVEL)
	})

	it.each([21, 100, -1, NaN, Infinity, undefined])(
		'keeps medium for large or unknown executable sizes: %s (ac-edf028a4)',
		(lines) => {
			expect(review_level.level_for([CODE], lines)).toBe(review_level.DEFAULT_LEVEL)
		},
	)

	it('reduces the level when every changed path is inert', () => {
		expect(review_level.level_for([EDITOR_SETTING, '.gitignore'])).toBe(review_level.REDUCED_LEVEL)
	})

	it('keeps the default level for executable code', () => {
		expect(review_level.level_for([CODE])).toBe(review_level.DEFAULT_LEVEL)
	})

	// One executable file without a size measurement decides the whole change: a review reads the
	// change, not a subset of it.
	it('keeps the default level when one non-inert path is mixed in', () => {
		expect(review_level.level_for([EDITOR_SETTING, CODE])).toBe(review_level.DEFAULT_LEVEL)
	})

	it.each([
		RULES_DOCUMENT,
		'AGENTS.md',
		'prompts/review.md',
		'.claude/skills/x/SKILL.md',
		'docs/sync.md',
		'docs/example.txt',
		'tests/fixtures/example.ts',
		'prompts/example.txt',
		'scripts/example.test.ts',
		'tests/example.spec.ts',
	])('reduces the level for %s', (path) => {
		expect(review_level.level_for([path])).toBe(review_level.REDUCED_LEVEL)
	})
})

describe('review level empty paths', () => {
	// Answering `low` here would hand a reduced level to a caller that failed to read the diff.
	it('keeps the default level for an empty diff', () => {
		expect(review_level.level_for([])).toBe(review_level.DEFAULT_LEVEL)
	})

	it('ignores blank lines a diff listing may end with', () => {
		expect(review_level.level_for([EDITOR_SETTING, '', '  '])).toBe(review_level.REDUCED_LEVEL)
	})
})

describe('review_level.is_inert', () => {
	it.each([...review_level.INERT_PATHS])('treats %s as inert', (path) => {
		expect(review_level.is_inert(path)).toBe(true)
	})

	// Distribution disqualifies on its own: `package.json`'s `files` ships `.vscode/`,
	// `.gitattributes` and `.prettierignore` into every consumer project, so a defect in one reaches
	// a consumer exactly as a defect in a document does.
	it.each(['.vscode/settings.json', '.gitattributes', '.prettierignore'])(
		'does not treat the distributed %s as inert',
		(path) => {
			expect(review_level.is_inert(path)).toBe(false)
		},
	)

	it('treats a workspace file as inert wherever it sits', () => {
		expect(review_level.is_inert('nested/kit.code-workspace')).toBe(true)
	})

	// The list is a set of exact paths, not a set of names: a `LICENSE` inside a source tree is not
	// the repository's license file and should not buy a reduced review.
	it('does not treat a same-named file in a subdirectory as inert', () => {
		expect(review_level.is_inert('scripts/LICENSE')).toBe(false)
	})
})

describe('review_level.deciding_paths', () => {
	it('names the paths that forced the default level', () => {
		expect(review_level.deciding_paths([EDITOR_SETTING, CODE])).toStrictEqual([CODE])
	})

	it('names nothing when every path is inert', () => {
		expect(review_level.deciding_paths([EDITOR_SETTING])).toStrictEqual([])
	})
})
