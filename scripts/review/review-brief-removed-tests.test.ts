import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { describe, expect, it } from 'vitest'
import type { Removal } from './removed-tests'
import { review_brief } from './review-brief'
import {
	review_untouched_readers,
	type Readers,
	type ReadersRead,
} from './review-untouched-readers'

// joshuafolkken/kit#4287: a test the change deletes is listed in the brief, so the reviewer accounts
// for it rather than reading the deletion as an ordinary hunk. joshuafolkken/kit#4515: the readers
// outside the diff of each edited name are listed beside it, the brief's other optional section.

const TITLE = 'removed_tests > lists a gone test'
const HEADING = 'Removed tests'
const READERS_HEADING = review_untouched_readers.HEADING
const TIDY_HIT = { path: 'scripts/run/tidy/run-tidy-cli.ts', line: '34', excerpt: 'memoized(x)' }
const MAX_HITS = 10

interface Sections {
	removed?: Removal
	readers?: ReadersRead
}

function compose(sections: Sections = {}): string {
	return review_brief.compose({
		level: 'medium',
		profile: agent_role_profile.DEFAULT_PROFILES.reviewer,
		round: 1,
		tree: {},
		stamps: { gate: undefined, in_flight: undefined, round_one: undefined },
		checkout: {
			root: '/lanes/4287',
			branch: '4287-lane',
			head: '0123456789abcdef0123456789abcdef01234567',
		},
		nonce: 'deadbeefcafef00d',
		base: 'fedcba9876543210fedcba9876543210fedcba98',
		rubric_path: '/kit/prompts/review-rubric.md',
		removed_tests: sections.removed,
		readers: sections.readers,
	})
}

function readers_of(hits: Readers['hits'], has_failed = false): ReadersRead {
	const target = 'issue_merged.read_merged'
	const origin = 'scripts/issue/issue-merged.ts:91'

	return { readers: [{ target, origin, hits, has_failed }], omitted: 0, has_failed: false }
}

describe('review_brief.compose — removed tests', () => {
	it('lists each removed test as an undisposed row', () => {
		const brief = compose({ removed: { removed: [TITLE], renamed: [] } })

		expect(brief).toContain(HEADING)
		expect(brief).toContain(`- \`${TITLE}\` — 未記入`)
	})

	// joshuafolkken/kit#7883: the reviewer is not asked to find a renamed test's replacement.
	it('writes a renamed test’s row with its new title, as no finding for the reviewer', () => {
		const renamed = [{ from: TITLE, to: 'removed_tests > lists a test gone' }]
		const brief = compose({ removed: { removed: [TITLE], renamed } })

		expect(brief).toContain(`- \`${TITLE}\` — 置き換え: \`removed_tests > lists a test gone\``)
		expect(brief).toContain('a rename the check matched by its body — not a finding')
	})

	it('omits the section when the change removed no test', () => {
		expect(compose({ removed: { removed: [], renamed: [] } })).not.toContain(HEADING)
	})

	it('omits the section when the list is absent', () => {
		expect(compose()).not.toContain(HEADING)
	})
})

describe('review_brief.compose — readers outside the diff', () => {
	it('lists each edited name with its origin and each reader at file:line', () => {
		const brief = compose({ readers: readers_of([TIDY_HIT]) })

		expect(brief).toContain(READERS_HEADING)
		expect(brief).toContain('- `issue_merged.read_merged` — scripts/issue/issue-merged.ts:91')
		expect(brief).toContain('  - scripts/run/tidy/run-tidy-cli.ts:34  memoized(x)')
	})

	it('caps the readers of one name and counts the rest', () => {
		const brief = compose({ readers: readers_of(Array.from({ length: 12 }, () => TIDY_HIT)) })

		expect(brief.split('run-tidy-cli.ts:34')).toHaveLength(MAX_HITS + 1)
		expect(brief).toContain('  - … and 2 more')
	})

	it('marks a name whose search failed instead of listing it reader-free', () => {
		expect(compose({ readers: readers_of([], true) })).toContain('git grep failed; not searched')
	})

	it('omits the section when no edited name has a reader outside the diff', () => {
		const read = { readers: [], omitted: 0, has_failed: false }

		expect(compose({ readers: read })).not.toContain(READERS_HEADING)
	})

	it('counts the edited names past the cap even when no searched name has a reader', () => {
		const brief = compose({ readers: { readers: [], omitted: 3, has_failed: false } })

		expect(brief).toContain(READERS_HEADING)
		expect(brief).toContain(`- … and 3 more edited names ${review_untouched_readers.OMITTED_TAIL}`)
	})

	it('omits the section for a caller that passes no read', () => {
		expect(compose()).not.toContain(READERS_HEADING)
	})

	it('says the list could not be read when the read failed', () => {
		expect(compose({ readers: review_untouched_readers.FAILED_READ })).toContain(
			review_untouched_readers.READ_FAILED,
		)
	})
})
