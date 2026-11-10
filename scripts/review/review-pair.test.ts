import { readFileSync } from 'node:fs'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { review_attest } from './review-attest'
import { review_pair } from './review-pair'
import { review_round } from './review-round'

// joshuafolkken/kit#6902: round 1's code brief is copied for a Sonnet reviewer only when the paired
// comparison is on, and the copy never lands where a review slot is read.

const ON = { [review_pair.PAIRED_ENV]: '1' }
const BRIEF = 'medium — review brief\nReview round: 1'
const make_directory = temporary_directory()

function fresh_directory(): string {
	return make_directory('review-pair-')
}

describe('review_pair.is_enabled', () => {
	it('is off by default and on only for 1', () => {
		expect(review_pair.is_enabled({})).toBe(false)
		expect(review_pair.is_enabled({ [review_pair.PAIRED_ENV]: 'true' })).toBe(false)
		expect(review_pair.is_enabled(ON)).toBe(true)
	})
})

describe('review_pair.offer', () => {
	it('writes nothing while the comparison is off', () => {
		expect(review_pair.offer(BRIEF, {}, fresh_directory())).toBeUndefined()
	})

	it('copies a round-1 brief that skips attest and submit, and names the Sonnet launch', () => {
		const directory = fresh_directory()
		const note = review_pair.offer(BRIEF, ON, directory) ?? ''
		const { brief, findings } = review_pair.paths(directory)
		const written = readFileSync(brief, 'utf8')

		expect(written).toContain('never run `review:attest` or `review:submit`')
		expect(written).toContain(findings)
		expect(note).toContain(`paired brief: ${brief}`)
		expect(note).toContain('paired model: claude-sonnet-5-5 · effort high')
		expect(note).toContain('review:pair')
	})

	it('puts the override under the level line, ahead of the steps it cancels', () => {
		const directory = fresh_directory()

		review_pair.offer(BRIEF, ON, directory)
		const written = readFileSync(review_pair.paths(directory).brief, 'utf8')
		const [level, , heading] = written.split('\n', 3)

		expect(level).toBe('medium — review brief')
		expect(heading).toBe('## Paired comparison run — recorded only, never gating')
		expect(written.indexOf('Review round: 1')).toBeGreaterThan(written.indexOf('## Paired'))
	})

	it('launches the paired reviewer with a prompt that never names the attest step as one to follow', () => {
		const note = review_pair.offer(BRIEF, ON, fresh_directory()) ?? ''
		const prompt = note.split('\n').find((line) => line.startsWith('paired prompt: ')) ?? ''

		expect(prompt).toContain('never run review:attest or review:submit')
		expect(prompt).not.toContain('its review:attest step')
	})

	it('never pairs round 2', () => {
		const final = `${BRIEF}\n${review_round.FINAL_LINE}`

		expect(review_pair.offer(final, ON, fresh_directory())).toBeUndefined()
	})
})

// joshuafolkken/kit#7020: the ship's reviewer launch reads a paired brief's presence as the pair being on.
describe('review_pair.is_offered', () => {
	it('holds from a paired round 1 until an unpaired brief removes it', () => {
		const directory = fresh_directory()

		expect(review_pair.is_offered(directory)).toBe(false)
		review_pair.offer(BRIEF, ON, directory)
		expect(review_pair.is_offered(directory)).toBe(true)
		review_pair.offer(BRIEF, {}, directory)
		expect(review_pair.is_offered(directory)).toBe(false)
	})

	it('ends with a round 2 brief', () => {
		const directory = fresh_directory()

		review_pair.offer(BRIEF, ON, directory)
		review_pair.offer(`${BRIEF}\n${review_round.FINAL_LINE}`, ON, directory)

		expect(review_pair.is_offered(directory)).toBe(false)
	})
})

describe('review_pair.paths', () => {
	it('shares no file with any review slot attest or the ship reads', () => {
		const directory = fresh_directory()
		const paired = Object.values(review_pair.paths(directory))
		const slot_files = new Set(
			review_attest.REVIEW_SLOTS.flatMap((slot) =>
				Object.values(lane_session_broker.review_paths(directory, slot)),
			),
		)

		expect(paired.filter((file) => slot_files.has(file))).toStrictEqual([])
		expect(review_attest.REVIEW_SLOTS).toStrictEqual(['code', 'interaction'])
	})
})
