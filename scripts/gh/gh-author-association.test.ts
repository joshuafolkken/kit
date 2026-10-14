import { describe, expect, it } from 'vitest'
import { gh_author_association } from './gh-author-association'

describe('is_trusted', () => {
	it.each(['OWNER', 'MEMBER', 'COLLABORATOR'])(
		'trusts %s, which can write to the repository',
		(association) => {
			expect(gh_author_association.is_trusted(association)).toBe(true)
		},
	)

	// On a public repository anyone can comment, so a body kit acts on is never taken from them.
	it.each(['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', 'owner'])(
		'does not trust %s',
		(association) => {
			expect(gh_author_association.is_trusted(association)).toBe(false)
		},
	)

	it('does not trust an author whose association is unknown', () => {
		expect(gh_author_association.is_trusted(undefined)).toBe(false)
		// eslint-disable-next-line unicorn/no-null -- REST sends null for an author it cannot classify
		expect(gh_author_association.is_trusted(null)).toBe(false)
	})
})

describe('TRUSTED_LIST', () => {
	it('names every trusted association for a refusal message', () => {
		expect(gh_author_association.TRUSTED_LIST).toBe('OWNER / MEMBER / COLLABORATOR')
	})
})
