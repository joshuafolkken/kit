import { issue_read } from '#scripts/issue/issue-read'
import { describe, expect, it } from 'vitest'
import { run_prep_summary } from './run-prep-summary'

const SYMPTOM = 'The plan stage takes minutes.'
const EXPECTED = '- run:prep prints the skeleton'
const BODY = [
	'## 現象',
	'',
	SYMPTOM,
	'',
	'## 期待結果',
	'',
	EXPECTED,
	'',
	'## 受け入れ条件',
	'',
	'- [ ] first criterion',
	'- [x] second criterion',
	'',
	'## 期待効果',
	'',
	'- not copied',
].join('\n')

const EMPTY_SKELETON = ['## Now', '', '## Change', '', '## Check'].join('\n')

function trusted(body: string): string {
	return run_prep_summary.format_summary(body, true)
}

describe('run_prep_summary.format_summary', () => {
	it('copies Now and Change and puts an empty test line under each of two criteria', () => {
		expect(trusted(BODY)).toBe(
			[
				'## Now',
				SYMPTOM,
				'',
				'## Change',
				EXPECTED,
				'',
				'## Check',
				'- first criterion',
				'  - test:',
				'- second criterion',
				'  - test:',
			].join('\n'),
		)
	})

	it('prints the empty headings alone when the body has none of the sections', () => {
		expect(trusted('Just prose.\n\n## 背景\n\n- other')).toBe(EMPTY_SKELETON)
	})

	it('prints the empty headings alone for an empty body', () => {
		expect(trusted('')).toBe(EMPTY_SKELETON)
	})

	it('ignores a section heading quoted inside a code fence', () => {
		expect(trusted(['```', '## 現象', 'example', '```'].join('\n'))).toBe(EMPTY_SKELETON)
	})

	it('keeps the blank line between two paragraphs of a section', () => {
		const body = ['## 現象', '', 'first', '', 'second', ''].join('\n')

		expect(trusted(body)).toBe(
			['## Now', 'first', '', 'second', '', '## Change', '', '## Check'].join('\n'),
		)
	})
})

describe('run_prep_summary.format_summary author trust', () => {
	it('puts the untrusted-body heading first when the author is not trusted', () => {
		expect(run_prep_summary.format_summary(BODY, false)).toBe(
			`${issue_read.UNTRUSTED_BODY_HEADING}\n\n${trusted(BODY)}`,
		)
	})

	it('treats an unknown author as untrusted', () => {
		expect(run_prep_summary.format_summary('', undefined)).toBe(
			`${issue_read.UNTRUSTED_BODY_HEADING}\n\n${EMPTY_SKELETON}`,
		)
	})
})
