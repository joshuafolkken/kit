import { session_cite } from '#scripts/issue/session-cite'
import { describe, expect, it, vi } from 'vitest'
import type { EpicChild, IssueReference } from './epic-graph'
import {
	epic_outside_blocker,
	type DependencyVerdict,
	type ResolveDependency,
} from './epic-outside-blocker'

// Pins how a blocker no graph in this invocation tracks is weighed (joshuafolkken/kit#1943).

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const CHILD_NUMBER = 10
const BLOCKER_NUMBER = 20
const CHILD_KEY = `${REPO}#${String(CHILD_NUMBER)}`
const BLOCKER_KEY = `${OTHER_REPO}#${String(BLOCKER_NUMBER)}`

const CHILD: EpicChild = {
	number: CHILD_NUMBER,
	repo: REPO,
	state: 'OPEN',
	labels: [],
	blocked_by: [],
}

const NOTHING_RUNNING: ReadonlySet<string> = new Set()

function blocker(state: IssueReference['state']): IssueReference {
	return state === undefined
		? { repo: OTHER_REPO, number: BLOCKER_NUMBER }
		: { repo: OTHER_REPO, number: BLOCKER_NUMBER, state }
}

function resolver_answering(verdict: DependencyVerdict): ResolveDependency {
	return function resolve(): DependencyVerdict {
		return verdict
	}
}

const NEVER_CALLED = resolver_answering('resolved')

describe('epic_outside_blocker.outside_category — an unread blocker', () => {
	it('waits on time and announces the unread state once per pair', () => {
		const answer = epic_outside_blocker.outside_category(
			CHILD,
			blocker(undefined),
			NEVER_CALLED,
			NOTHING_RUNNING,
		)

		expect(answer).toStrictEqual({
			category: 'time',
			notice: {
				key: `unread:${CHILD_KEY}:${BLOCKER_KEY}`,
				message: `⚠ ${session_cite.issue(CHILD_NUMBER, undefined, REPO)} is blocked by ${BLOCKER_KEY}, whose state could not be read — it waits rather than runs`,
			},
		})
	})

	it('never consults the resolver when the state was not read', () => {
		const resolve = vi.fn(resolver_answering('resolved'))

		epic_outside_blocker.outside_category(CHILD, blocker(undefined), resolve, NOTHING_RUNNING)

		expect(resolve).not.toHaveBeenCalled()
	})
})

describe('epic_outside_blocker.outside_category — an open blocker', () => {
	it('waits on time without a notice when this run also runs the blocker', () => {
		const running = new Set([BLOCKER_KEY])
		const answer = epic_outside_blocker.outside_category(
			CHILD,
			blocker('OPEN'),
			NEVER_CALLED,
			running,
		)

		expect(answer).toStrictEqual({ category: 'time' })
	})

	it('is withheld for a person when this run will not finish the blocker', () => {
		const answer = epic_outside_blocker.outside_category(
			CHILD,
			blocker('OPEN'),
			NEVER_CALLED,
			new Set([CHILD_KEY]),
		)

		expect(answer).toStrictEqual({
			category: 'human',
			notice: {
				key: `outside:${CHILD_KEY}:${BLOCKER_KEY}`,
				message: `⚠ ${session_cite.issue(CHILD_NUMBER, undefined, REPO)} waits on ${BLOCKER_KEY}, which this run will not finish — withheld for a person`,
			},
		})
	})
})

describe('epic_outside_blocker.outside_category — a closed blocker', () => {
	it.each<[DependencyVerdict, 'time' | 'human' | undefined]>([
		['resolved', undefined],
		['time', 'time'],
		['human', 'human'],
		['inherit', 'time'],
	])('maps the resolver verdict %s to the category %s', (verdict, expected) => {
		const answer = epic_outside_blocker.outside_category(
			CHILD,
			blocker('CLOSED'),
			resolver_answering(verdict),
			NOTHING_RUNNING,
		)

		expect(answer).toStrictEqual({ category: expected })
	})

	it('hands the resolver the reference as a closed child, then the blocked child', () => {
		const resolve = vi.fn(resolver_answering('resolved'))

		epic_outside_blocker.outside_category(CHILD, blocker('CLOSED'), resolve, NOTHING_RUNNING)

		expect(resolve).toHaveBeenCalledWith(
			{ number: BLOCKER_NUMBER, repo: OTHER_REPO, state: 'CLOSED', labels: [], blocked_by: [] },
			CHILD,
		)
	})
})

describe('epic_outside_blocker.running_keys', () => {
	it('keys every issue by repository and number', () => {
		const keys = epic_outside_blocker.running_keys([CHILD, blocker('OPEN')])

		expect([...keys]).toStrictEqual([CHILD_KEY, BLOCKER_KEY])
	})

	it('collapses duplicates and answers an empty set for no issues', () => {
		expect(epic_outside_blocker.running_keys([CHILD, CHILD]).size).toBe(1)
		expect(epic_outside_blocker.running_keys([]).size).toBe(0)
	})
})
