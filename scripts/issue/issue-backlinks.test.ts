import { describe, expect, it } from 'vitest'
import { issue_backlinks } from './issue-backlinks'

const UPSTREAM_HEADING = '## Upstream issues'
const UPSTREAM_REF = 'joshuafolkken/kit#42'
const WRONG_HEADING = 'wrong-heading'
const MISSING_UPSTREAM = 'missing-upstream'
const NEAR_MISS_HEADING = '## Upstream'
const NO_UPSTREAM_BODY = '## 背景\n\nnothing'

const ORIGIN_WITH_UPSTREAM = [UPSTREAM_HEADING, '', `- ${UPSTREAM_REF}`].join('\n')
const CHECKBOX_SECTION = [UPSTREAM_HEADING, '', `- [ ] ${UPSTREAM_REF}`].join('\n')
const NEAR_MISS_SECTION = [NEAR_MISS_HEADING, '', `- ${UPSTREAM_REF}`].join('\n')
const UPSTREAM_CITING_BACK = ['## Origin', '', 'joshuafolkken/app-kit#7'].join('\n')

describe('issue_backlinks.classify_backlinks — a complete pair', () => {
	it('is ok when the pair points both ways', () => {
		const verdict = issue_backlinks.classify_backlinks(ORIGIN_WITH_UPSTREAM, [
			{ ref: UPSTREAM_REF, body: UPSTREAM_CITING_BACK },
		])

		expect(verdict).toBe('ok')
	})

	it('accepts a candidate-only body as ok', () => {
		const candidate = ['## Upstream candidate', '', '- joshuafolkken/other#9 (draft)'].join('\n')

		expect(issue_backlinks.classify_backlinks(candidate, [])).toBe('ok')
	})
})

describe('issue_backlinks.classify_backlinks — broken pairs', () => {
	it('is missing-upstream when no backlink heading is present', () => {
		expect(issue_backlinks.classify_backlinks(NO_UPSTREAM_BODY, [])).toBe(MISSING_UPSTREAM)
	})

	it('is missing-origin when an upstream does not cite back', () => {
		const verdict = issue_backlinks.classify_backlinks(ORIGIN_WITH_UPSTREAM, [
			{ ref: UPSTREAM_REF, body: '## 背景\n\nno origin heading' },
		])

		expect(verdict).toBe('missing-origin')
	})

	it('is wrong-heading for a near-miss heading', () => {
		expect(issue_backlinks.classify_backlinks(NEAR_MISS_SECTION, [])).toBe(WRONG_HEADING)
	})

	it('is wrong-heading for a bare reference', () => {
		const bare = [UPSTREAM_HEADING, '', '- #42'].join('\n')

		expect(issue_backlinks.classify_backlinks(bare, [])).toBe(WRONG_HEADING)
	})

	it('is wrong-heading for a checkbox reference', () => {
		expect(issue_backlinks.classify_backlinks(CHECKBOX_SECTION, [])).toBe(WRONG_HEADING)
	})

	it('is missing-upstream when the heading is present but lists no reference', () => {
		const empty_section = [UPSTREAM_HEADING, '', 'nothing filed yet'].join('\n')

		expect(issue_backlinks.classify_backlinks(empty_section, [])).toBe(MISSING_UPSTREAM)
	})
})

describe('issue_backlinks.upstream_refs', () => {
	it('lists the qualified upstream references', () => {
		expect(issue_backlinks.upstream_refs(ORIGIN_WITH_UPSTREAM)).toEqual([UPSTREAM_REF])
	})
})

describe('issue_backlinks.needs_upstreams', () => {
	it('is true when a valid upstream section lists references to fetch', () => {
		expect(issue_backlinks.needs_upstreams(ORIGIN_WITH_UPSTREAM)).toBe(true)
	})

	it('is false for a wrong heading, so no unreadable upstream masks the verdict', () => {
		expect(issue_backlinks.needs_upstreams(NEAR_MISS_SECTION)).toBe(false)
	})

	it('is false for a malformed checkbox section decided from the origin alone', () => {
		expect(issue_backlinks.needs_upstreams(CHECKBOX_SECTION)).toBe(false)
	})

	it('is false when there is no upstream heading', () => {
		expect(issue_backlinks.needs_upstreams(NO_UPSTREAM_BODY)).toBe(false)
	})
})
