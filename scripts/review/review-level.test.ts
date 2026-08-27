import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { review_level } from './review-level'
import { review_level_cli } from './review-level-cli'

const CODE = 'scripts/review/review-level.ts'
const EDITOR_SETTING = '.editorconfig'
const RULES_DOCUMENT = 'CLAUDE.md'

describe('review_level.level_for', () => {
	it('reduces the level when every changed path is inert', () => {
		expect(review_level.level_for([EDITOR_SETTING, '.gitignore'])).toBe(review_level.REDUCED_LEVEL)
	})

	it('keeps the default level for executable code', () => {
		expect(review_level.level_for([CODE])).toBe(review_level.DEFAULT_LEVEL)
	})

	// One executable or instruction file in the diff decides the whole change: a review reads the
	// change, not a subset of it.
	it('keeps the default level when one non-inert path is mixed in', () => {
		expect(review_level.level_for([EDITOR_SETTING, CODE])).toBe(review_level.DEFAULT_LEVEL)
	})

	// The opposite of what the "Non-runtime updates" testing exception does with documentation, and
	// deliberately so: kit#963 and #965 were documentation-only and a `medium` review found ten real
	// defects in each, in artifacts distributed to every consumer.
	it.each([
		RULES_DOCUMENT,
		'AGENTS.md',
		'prompts/review.md',
		'.claude/skills/x/SKILL.md',
		'docs/sync.md',
	])('does not reduce the level for %s', (path) => {
		expect(review_level.level_for([path])).toBe(review_level.DEFAULT_LEVEL)
	})

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

describe('josh review:level registration', () => {
	it('is registered as a josh command', () => {
		const entry = COMMAND_MAP['review:level']

		expect(entry?.script).toBe('scripts/review/review-level-cli.ts')
	})

	it('has a short alias', () => {
		const { rl } = ALIASES

		expect(rl).toBe('review:level')
	})
})

describe('review_level_cli.format_reason', () => {
	it('says why a change was reduced', () => {
		expect(review_level_cli.format_reason([EDITOR_SETTING], review_level.REDUCED_LEVEL)).toContain(
			'inert',
		)
	})

	it('names the path that forced the default level', () => {
		expect(review_level_cli.format_reason([CODE], review_level.DEFAULT_LEVEL)).toContain(CODE)
	})

	it('explains an empty diff rather than naming nothing', () => {
		expect(review_level_cli.format_reason([], review_level.DEFAULT_LEVEL)).toContain(
			'no changed paths',
		)
	})
})
