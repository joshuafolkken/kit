import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pr_classification } from './pr-classification'

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

describe('issue release classification', () => {
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

it('reads the current labels from a GitHub pull request event', () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'pr-classification-'))
	const event_path = path.join(directory, 'event.json')

	try {
		writeFileSync(
			event_path,
			JSON.stringify({ pull_request: { user: { login: HUMAN }, labels: [{ name: BUGFIX }] } }),
		)
		expect(pr_classification.check_event(event_path)).toBeUndefined()
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
