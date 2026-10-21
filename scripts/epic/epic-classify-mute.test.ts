import { describe, expect, it, vi } from 'vitest'
import { epic_classify } from './epic-classify'
import type { EpicChild } from './epic-graph'

// Its own file: muting holds for the rest of the process, which would silence the notice tests beside it.

const REPO = 'joshuafolkken/kit'
const OUTSIDE = 999

const WITHHELD: EpicChild = {
	repo: REPO,
	number: 2,
	state: 'OPEN',
	labels: [],
	blocked_by: [{ repo: REPO, number: OUTSIDE, state: 'OPEN' }],
}

describe('epic_classify.mute_notices', () => {
	it('still withholds the child for a person, saying nothing on standard error', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		epic_classify.reset_reported()
		epic_classify.mute_notices()

		const result = epic_classify.classify_children([WITHHELD])

		expect(result.human.map((entry) => entry.number)).toEqual([2])
		expect(warn).not.toHaveBeenCalled()
		warn.mockRestore()
	})
})
