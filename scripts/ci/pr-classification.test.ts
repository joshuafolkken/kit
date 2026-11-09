import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { pr_classification } from './pr-classification'

const make_directory = temporary_directory()

const HUMAN = 'contributor'
const BOT = 'dependabot[bot]'
const BREAKING = 'breaking-change'
const ENHANCEMENT = 'enhancement'
const BUGFIX = 'bugfix'
const OTHER = 'other-change'
const IGNORE = 'ignore-for-release'
const DUPLICATE_ERROR = 'Choose exactly one'
const LEGACY_ERROR = 'Remove legacy release labels'
const CHOOSE_ERROR = 'Choose one release classification'
const REPOSITORY = 'owner/repo'
const PULL_NUMBER = 42

// A script that writes an issue body builds the line with `declaration` (joshuafolkken/kit#2858).
describe('issue release classification declaration', () => {
	it.each([BREAKING, ENHANCEMENT, BUGFIX, OTHER, IGNORE] as const)(
		'accepts the declaration line it builds for %s',
		(label) => {
			const issue = JSON.stringify({ labels: [], body: pr_classification.declaration(label) })

			expect(pr_classification.select_issue_classification(issue)).toBe(label)
		},
	)
})

// joshuafolkken/kit#6732: `josh issue:release-class` writes the line, so a lane need not park for it.
describe('pr_classification.with_declaration', () => {
	const BACKGROUND =
		'## 背景\n\n- 種別: 非不具合\n- 目的: 機能改善\n\n本文\n\n## 受け入れ条件\n\n- [ ] x\n'
	const DECLARED = `## 背景\n\n- 種別: 非不具合\n- 目的: 機能改善\n- リリース分類: ${ENHANCEMENT}\n\n本文\n\n## 受け入れ条件\n\n- [ ] x\n`

	it('closes the background declaration block with exactly one line (ac-172cafb3)', () => {
		const once = pr_classification.with_declaration(BACKGROUND, ENHANCEMENT)

		expect(once).toBe(DECLARED)
		expect(pr_classification.with_declaration(once, ENHANCEMENT)).toBe(DECLARED)
	})

	it('replaces an earlier declaration rather than adding a second', () => {
		const changed = pr_classification.with_declaration(DECLARED, OTHER)

		expect(changed).toBe(DECLARED.replace(ENHANCEMENT, () => OTHER))
		expect(pr_classification.select_classification([], changed)).toBe(OTHER)
	})

	it('puts the line under a background heading that ends the body', () => {
		expect(pr_classification.with_declaration('## 背景', OTHER)).toBe(
			`## 背景\n- リリース分類: ${OTHER}\n`,
		)
	})

	it('appends the line to a body with no background section', () => {
		expect(pr_classification.with_declaration('text', OTHER)).toBe(
			`text\n- リリース分類: ${OTHER}\n`,
		)
	})
})

// joshuafolkken/kit#6732: the ship and commit preflight checks surface this error, so it names the command.
describe('the missing classification stop message', () => {
	it('names the command that writes the declaration (ac-61132ca8)', () => {
		expect(() => pr_classification.select_classification([], '')).toThrow(
			'pnpm josh issue:release-class <issue> <label>',
		)
	})

	it('asks for one of the conflicting classifications to go instead', () => {
		expect(() =>
			pr_classification.select_classification([ENHANCEMENT], `- リリース分類: ${OTHER}`),
		).toThrow(`found: ${ENHANCEMENT}, ${OTHER}. Keep one.`)
	})
})

describe('issue release classification', () => {
	it('selects from label names and a body without the GitHub JSON', () => {
		expect(pr_classification.select_classification(['bug'], '')).toBe(BUGFIX)
		expect(() =>
			pr_classification.select_classification(['bug'], `- リリース分類: ${ENHANCEMENT}`),
		).toThrow(CHOOSE_ERROR)
	})

	it('maps an issue bug label to the PR bugfix classification', () => {
		const issue = JSON.stringify({ labels: [{ name: 'bug' }], body: '' })

		expect(pr_classification.select_issue_classification(issue)).toBe(BUGFIX)
		expect(pr_classification.classification_error([BUGFIX], HUMAN)).toBeUndefined()
	})

	it.each([BREAKING, ENHANCEMENT, BUGFIX, OTHER, IGNORE])('selects declared %s', (label) => {
		const issue = JSON.stringify({ labels: [], body: `- リリース分類: ${label}` })

		expect(pr_classification.select_issue_classification(issue)).toBe(label)
	})

	it('lets an explicit breaking change override the issue bug label', () => {
		const issue = JSON.stringify({ labels: [{ name: 'bug' }], body: `- リリース分類: ${BREAKING}` })

		expect(pr_classification.select_issue_classification(issue)).toBe(BREAKING)
	})

	it('selects breaking change for an enhancement that breaks compatibility', () => {
		const issue = JSON.stringify({
			labels: [{ name: ENHANCEMENT }, { name: BREAKING }],
			body: '- 目的: 機能改善\n- 互換性: 破壊的変更',
		})

		expect(pr_classification.select_issue_classification(issue)).toBe(BREAKING)
	})

	it('keeps breaking change when a paired issue has an old enhancement declaration', () => {
		const issue = JSON.stringify({
			labels: [{ name: ENHANCEMENT }, { name: BREAKING }],
			body: `- リリース分類: ${ENHANCEMENT}`,
		})

		expect(pr_classification.select_issue_classification(issue)).toBe(BREAKING)
	})
})

describe('issue release classification refusals', () => {
	it('refuses a bug label paired with a different compatible classification', () => {
		const issue = JSON.stringify({
			labels: [{ name: 'bug' }],
			body: `- リリース分類: ${ENHANCEMENT}`,
		})

		expect(() => pr_classification.select_issue_classification(issue)).toThrow(CHOOSE_ERROR)
	})

	it.each(['', `- リリース分類: ${ENHANCEMENT}\n- リリース分類: ${OTHER}`])(
		'refuses missing or conflicting classification',
		(body) => {
			const issue = JSON.stringify({ labels: [], body })

			expect(() => pr_classification.select_issue_classification(issue)).toThrow(CHOOSE_ERROR)
		},
	)

	it('refuses malformed and unknown classification data', () => {
		expect(() => pr_classification.select_issue_classification('')).toThrow()
		expect(() =>
			pr_classification.select_issue_classification(
				JSON.stringify({ labels: [], body: '- リリース分類: unknown' }),
			),
		).toThrow('Unknown release classification')
	})

	it('treats a null Issue body as an unspecified classification', () => {
		const issue = '{"labels":[],"body":null}'

		expect(() => pr_classification.select_issue_classification(issue)).toThrow(CHOOSE_ERROR)
	})
})

describe('pull request release classification', () => {
	it.each([BREAKING, ENHANCEMENT, BUGFIX, OTHER, IGNORE])('accepts one %s label', (label) => {
		expect(pr_classification.classification_error([label], HUMAN)).toBeUndefined()
	})

	it('recognizes classification labels regardless of case', () => {
		expect(pr_classification.classification_error([BUGFIX.toUpperCase()], HUMAN)).toBeUndefined()
		expect(pr_classification.classification_error([BUGFIX.toUpperCase(), OTHER], HUMAN)).toContain(
			DUPLICATE_ERROR,
		)
	})

	it('rejects a human pull request without a classification', () => {
		expect(pr_classification.classification_error(['documentation'], HUMAN)).toContain(CHOOSE_ERROR)
	})

	it('passes after a missing classification is added', () => {
		expect(pr_classification.classification_error([], HUMAN)).toBeDefined()
		expect(pr_classification.classification_error([BUGFIX], HUMAN)).toBeUndefined()
	})

	it('rejects two classifications even when one is breaking or excluded', () => {
		expect(pr_classification.classification_error([BREAKING, ENHANCEMENT], HUMAN)).toContain(
			DUPLICATE_ERROR,
		)
		expect(pr_classification.classification_error([IGNORE, OTHER], HUMAN)).toContain(
			DUPLICATE_ERROR,
		)
	})

	it('treats an unclassified bot pull request as Other Changes', () => {
		expect(pr_classification.classification_error([], BOT)).toBeUndefined()
	})

	it('rejects duplicate classifications on a bot pull request', () => {
		expect(pr_classification.classification_error([BUGFIX, OTHER], BOT)).toContain(DUPLICATE_ERROR)
	})
})

it('rejects legacy release labels alongside a new classification', () => {
	expect(pr_classification.classification_error(['Semver-Major', BUGFIX], HUMAN)).toContain(
		LEGACY_ERROR,
	)
	expect(pr_classification.classification_error(['Semver-Minor', ENHANCEMENT], BOT)).toContain(
		LEGACY_ERROR,
	)
})

// The `opened` payload carries no labels because `josh pr` labels the pull request in a second call;
// the check has to judge the labels as they stand, or that run fails for good (joshuafolkken/kit#2712).
it('judges the labels the pull request has now, not the ones its event carried', () => {
	const directory = make_directory('pr-classification-')
	const event_path = path.join(directory, 'event.json')
	const requests: Array<string> = []

	writeFileSync(
		event_path,
		JSON.stringify({
			pull_request: { number: PULL_NUMBER, user: { login: HUMAN }, labels: [] },
			repository: { full_name: REPOSITORY },
		}),
	)
	const error = pr_classification.check_event(event_path, (repository, pull_number) => {
		requests.push(`${repository}#${String(pull_number)}`)

		return [BUGFIX]
	})

	expect(error).toBeUndefined()
	expect(requests).toEqual([`${REPOSITORY}#${String(PULL_NUMBER)}`])
})
