import { describe, expect, it } from 'vitest'
import { acceptance_map } from './acceptance-map'

const FIRST = acceptance_map.criterion_id('First condition')
const SECOND = acceptance_map.criterion_id('Second condition wrapped')

describe('acceptance_map.tick', () => {
	it('preserves every byte outside selected checkboxes (ac-ed7af940)', () => {
		const body =
			'## Background\r\n- [ ] First condition\n\n## 受け入れ条件\r\n- [ ] First condition\r\n- [ ] Second condition\n  wrapped\r\n  - [ ] nested\n```md\n- [ ] First condition\n## Example\n```\n## Notes\r\n- [ ] First condition'
		const expected = body
			.replace('条件\r\n- [ ] First', '条件\r\n- [x] First')
			.replace('- [ ] Second', '- [x] Second')

		expect(acceptance_map.tick(body, [FIRST, SECOND])).toBe(expected)
	})

	it.each(['## Acceptance criteria', '## 受け入れ条件'])(
		'ticks one selected criterion under %s',
		(heading) => {
			const body = `${heading}\n- [ ] First condition\n- [ ] Other\n`

			expect(acceptance_map.tick(body, [FIRST])).toBe(
				`${heading}\n- [x] First condition\n- [ ] Other\n`,
			)
		},
	)

	it.each(['*', '+', '1.'])('keeps the %s list marker', (marker) => {
		const body = `## 受け入れ条件\n${marker} [ ] First condition`

		expect(acceptance_map.tick(body, [FIRST])).toBe(body.replace('[ ]', '[x]'))
	})

	it.each(['x', 'X'])('keeps already checked [%s] unchanged', (mark) => {
		const body = `## 受け入れ条件\n- [${mark}] First condition\n`

		expect(acceptance_map.tick(body, [FIRST, FIRST])).toBe(body)
	})
})

describe('acceptance_map.tick refusals', () => {
	it('refuses a stale ID before any partial result', () => {
		expect(() =>
			acceptance_map.tick('## 受け入れ条件\n- [ ] First condition', [FIRST, 'ac-stale']),
		).toThrow('ac-stale')
	})

	it.each([
		'',
		'## Notes\n- [ ] First condition',
		'```md\n## 受け入れ条件\n- [ ] First condition\n```',
	])('refuses a condition absent from the actual acceptance section', (body) => {
		expect(() => acceptance_map.tick(body, [FIRST])).toThrow('Unknown acceptance criteria')
	})

	it('refuses a selected criterion without a checkbox', () => {
		expect(() => acceptance_map.tick('## 受け入れ条件\n- First condition', [FIRST])).toThrow(
			'no checkbox',
		)
	})
})
