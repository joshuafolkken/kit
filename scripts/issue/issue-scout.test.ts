import { describe, expect, it } from 'vitest'
import { issue_scout, type DuplicateCandidate, type ScoutIssue } from './issue-scout'

const DRAFT_TITLE = 'Answer whether a new Issue already exists and which epic it belongs to'
const NEAR_DUPLICATE_TITLE = 'Answer whether a new Issue already exists before filing it'
const RESTATED_TITLE = 'Say which epic a new Issue belongs to, and whether it exists already'
const UNRELATED_TITLE = 'Stop a stalled push hanging josh git with no timeout or keepalive'
const WEAK_MATCH_TITLE = 'Print each verification-gate check elapsed time for a new run'

const NEAR_DUPLICATE_NUMBER = 1249
const RESTATED_NUMBER = 1166
const UNRELATED_NUMBER = 1251
const WEAK_MATCH_NUMBER = 1248
const FILLER_COUNT = 40
const FILLER_BASE_NUMBER = 900
const SINGLE_CANDIDATE = 1
const TWO_CANDIDATES = 2

function filler_issues(count: number): Array<ScoutIssue> {
	return Array.from({ length: count }, (_unused, index) => ({
		number: FILLER_BASE_NUMBER + index,
		title: `Unrelated background task number ${String(index)}`,
	}))
}

function candidates_of(
	title: string,
	issues: ReadonlyArray<ScoutIssue>,
): ReadonlyArray<DuplicateCandidate> {
	return issue_scout.find_duplicates(title, issues).candidates
}

function numbers_of(title: string, issues: ReadonlyArray<ScoutIssue>): Array<number> {
	return candidates_of(title, issues).map((candidate) => candidate.number)
}

describe('issue_scout.find_duplicates — a duplicate exists', () => {
	it('finds the open issue whose title restates the draft', () => {
		const issues = [
			{ number: UNRELATED_NUMBER, title: UNRELATED_TITLE },
			{ number: NEAR_DUPLICATE_NUMBER, title: NEAR_DUPLICATE_TITLE },
		]

		expect(numbers_of(DRAFT_TITLE, issues)).toStrictEqual([NEAR_DUPLICATE_NUMBER])
	})

	it('reports the candidate with its title and score, so the caller can judge it', () => {
		const issues = [{ number: NEAR_DUPLICATE_NUMBER, title: NEAR_DUPLICATE_TITLE }]
		const [candidate] = candidates_of(DRAFT_TITLE, issues)

		expect(candidate?.title).toBe(NEAR_DUPLICATE_TITLE)
		expect(candidate?.score).toBeGreaterThan(issue_scout.SIMILARITY_THRESHOLD)
	})

	it('matches a restatement that reorders the words', () => {
		const issues = [{ number: RESTATED_NUMBER, title: RESTATED_TITLE }]

		expect(numbers_of(DRAFT_TITLE, issues)).toStrictEqual([RESTATED_NUMBER])
	})
})

describe('issue_scout.find_duplicates — nothing to report', () => {
	it('answers with no candidate rather than the closest miss', () => {
		const issues = [{ number: UNRELATED_NUMBER, title: UNRELATED_TITLE }]

		expect(candidates_of(DRAFT_TITLE, issues)).toStrictEqual([])
	})

	it('does not push a weak match over the line on one shared word', () => {
		const issues = [{ number: WEAK_MATCH_NUMBER, title: WEAK_MATCH_TITLE }]

		expect(candidates_of(DRAFT_TITLE, issues)).toStrictEqual([])
	})

	it('answers nothing for an empty backlog', () => {
		expect(candidates_of(DRAFT_TITLE, [])).toStrictEqual([])
	})

	it('scores nothing for an issue read without a title', () => {
		const issues = [{ number: NEAR_DUPLICATE_NUMBER }]

		expect(candidates_of(DRAFT_TITLE, issues)).toStrictEqual([])
	})
})

describe('issue_scout.find_duplicates — several candidates', () => {
	it('reports every candidate above the threshold, strongest first', () => {
		const issues = [
			{ number: RESTATED_NUMBER, title: RESTATED_TITLE },
			{ number: UNRELATED_NUMBER, title: UNRELATED_TITLE },
			{ number: NEAR_DUPLICATE_NUMBER, title: NEAR_DUPLICATE_TITLE },
		]
		const found = candidates_of(DRAFT_TITLE, issues)

		expect(found).toHaveLength(TWO_CANDIDATES)
		expect(found[0]?.score).toBeGreaterThanOrEqual(found[1]?.score ?? 0)
	})

	it('caps the list so it stays short enough to read', () => {
		const issues = Array.from({ length: FILLER_COUNT }, (_unused, index) => ({
			number: FILLER_BASE_NUMBER + index,
			title: NEAR_DUPLICATE_TITLE,
		}))

		expect(candidates_of(DRAFT_TITLE, issues)).toHaveLength(issue_scout.MAX_CANDIDATES)
	})

	// A cap that reports the shown count as the found count states a truncation as a complete answer.
	it('reports how many cleared the bar, not how many are shown', () => {
		const issues = Array.from({ length: FILLER_COUNT }, (_unused, index) => ({
			number: FILLER_BASE_NUMBER + index,
			title: NEAR_DUPLICATE_TITLE,
		}))

		expect(issue_scout.find_duplicates(DRAFT_TITLE, issues).total).toBe(FILLER_COUNT)
	})
})

// An epic is a container, and "already filed as #<E>" sends the caller to run one that has no
// implementation of its own. The epic half of the same command excludes them for the same reason.
describe('issue_scout.find_duplicates — an epic is not a duplicate', () => {
	it('leaves an epic out however closely its title matches', () => {
		const issues = [{ number: RESTATED_NUMBER, title: NEAR_DUPLICATE_TITLE, is_epic: true }]

		expect(candidates_of(DRAFT_TITLE, issues)).toStrictEqual([])
	})

	it('names the epic tracking a candidate, which is where similar work already lives', () => {
		const issues = [
			{ number: NEAR_DUPLICATE_NUMBER, title: NEAR_DUPLICATE_TITLE, epic: RESTATED_NUMBER },
		]

		expect(candidates_of(DRAFT_TITLE, issues)[0]?.epic).toBe(RESTATED_NUMBER)
	})
})

describe('issue_scout.find_duplicates — the issue filed minutes ago', () => {
	it('finds a candidate sitting last in the listing', () => {
		const issues = [
			...filler_issues(FILLER_COUNT),
			{ number: NEAR_DUPLICATE_NUMBER, title: NEAR_DUPLICATE_TITLE },
		]

		expect(numbers_of(DRAFT_TITLE, issues)).toStrictEqual([NEAR_DUPLICATE_NUMBER])
	})

	it('scores every row rather than a prefix of the listing', () => {
		const issues = [
			{ number: NEAR_DUPLICATE_NUMBER, title: NEAR_DUPLICATE_TITLE },
			...filler_issues(FILLER_COUNT),
		]

		expect(candidates_of(DRAFT_TITLE, issues)).toHaveLength(SINGLE_CANDIDATE)
	})
})

describe('issue_scout.tokenize', () => {
	it('drops the words every title carries', () => {
		expect([...issue_scout.tokenize('the answer to a question')]).toStrictEqual([
			'answer',
			'question',
		])
	})

	it('splits punctuation, so a command name reads as its words', () => {
		expect([...issue_scout.tokenize('`josh epic:bundle`')]).toStrictEqual([
			'josh',
			'epic',
			'bundle',
		])
	})

	it('scores identical token sets as a full match', () => {
		const tokens = issue_scout.tokenize(DRAFT_TITLE)

		expect(issue_scout.dice_similarity(tokens, tokens)).toBe(1)
	})

	it('scores disjoint token sets as no match', () => {
		const left = issue_scout.tokenize(DRAFT_TITLE)
		const right = issue_scout.tokenize(UNRELATED_TITLE)

		expect(issue_scout.dice_similarity(left, right)).toBe(0)
	})
})
