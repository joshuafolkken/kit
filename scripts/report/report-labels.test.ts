import { afterEach, describe, expect, it, vi } from 'vitest'
import { report_labels } from './report-labels'

// joshuafolkken/kit#4157: one label table serves both languages; `ja` and its regional forms take the
// Japanese labels and every other language the English ones.

const ENV_KEY = 'JOSH_SESSION_LANG'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('report_labels.labels_for', () => {
	it.each(['ja', 'ja-JP', 'JA'])('gives %s the Japanese table', (lang) => {
		expect(report_labels.labels_for(lang)).toBe(report_labels.JAPANESE_LABELS)
	})

	it.each(['en', 'fr', ''])('gives %s the English table', (lang) => {
		expect(report_labels.labels_for(lang)).toBe(report_labels.ENGLISH_LABELS)
	})
})

describe('report_labels.session_labels', () => {
	it('defaults an unset session language to Japanese', () => {
		vi.stubEnv(ENV_KEY, undefined)

		expect(report_labels.session_labels()).toBe(report_labels.JAPANESE_LABELS)
	})

	it('follows a non-Japanese session language to English', () => {
		vi.stubEnv(ENV_KEY, 'en')

		expect(report_labels.session_labels()).toBe(report_labels.ENGLISH_LABELS)
	})
})

describe('the two tables', () => {
	it('carry the same case vocabulary length', () => {
		expect(report_labels.ENGLISH_LABELS.case_vocabulary).toHaveLength(
			report_labels.JAPANESE_LABELS.case_vocabulary.length,
		)
	})

	it('keep the slash out of the N/A marker the lint splits case lines on', () => {
		expect(report_labels.ENGLISH_LABELS.not_applicable).not.toContain('/')
		expect(report_labels.JAPANESE_LABELS.not_applicable).not.toContain('/')
	})
})
