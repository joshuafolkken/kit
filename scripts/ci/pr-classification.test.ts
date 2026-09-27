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

describe('pull request release classification', () => {
	it.each([BREAKING, ENHANCEMENT, BUGFIX, OTHER, IGNORE])('accepts one %s label', (label) => {
		expect(pr_classification.classification_error([label], HUMAN)).toBeUndefined()
	})

	it('rejects a human pull request without a classification', () => {
		expect(pr_classification.classification_error(['documentation'], HUMAN)).toContain(
			'Choose one release classification',
		)
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
