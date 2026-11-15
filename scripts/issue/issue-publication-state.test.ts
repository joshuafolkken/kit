import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { auto_ok_judge } from '#scripts/auto-ok/auto-ok-judge'
import { KICKOFF_BODY, USER_PROHIBITION } from '#scripts/auto-ok/auto-ok-kickoff-fixture'
import { epic_classify } from '#scripts/epic/epic-classify'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { expect, it } from 'vitest'
import { issue_publication_state } from './issue-publication-state'

const BODY = KICKOFF_BODY.trimEnd()
const LABELS = ['auto-ok', 'run:lane']
const NUMBER = 7427
const REPO = 'joshuafolkken/kit'
const PLANNED = 'run:planned'

it('rechecks a user prohibition added after preparation even with a manual approval', () => {
	const body = issue_publication_state.prepare(BODY, LABELS) + USER_PROHIBITION

	expect(issue_publication_state.labels_of(body, ['auto-ok', PLANNED])).toEqual([PLANNED])
})

it.each(['deferred', 'needs-human-review', 'breaking-change', 'epic', 'release'])(
	'withholds approval when %s is added after preparation',
	(label) => {
		const body = issue_publication_state.prepare(BODY, LABELS)

		expect(issue_publication_state.labels_of(body, [PLANNED, label])).toEqual([PLANNED, label])
	},
)

it('withholds prepared children from both judgement and epic runnable classification', () => {
	const body = issue_publication_state.prepare(BODY, LABELS)
	const child: EpicChild = {
		number: NUMBER,
		repo: REPO,
		state: 'OPEN',
		body,
		labels: ['run:lane'],
		blocked_by: [],
	}

	expect(auto_ok_judge.is_candidate({ ...child, body, is_trusted: true })).toBe(false)
	expect(epic_classify.classify_children([child]).runnable).toEqual([])
	expect(epic_classify.classify_children([child]).time).toEqual([child])
})

it('preserves user opt-out and unrelated labels when preparing and publishing', () => {
	const body = issue_publication_state.prepare(BODY, ['run:lane'])

	expect(body).not.toContain('no-auto-ok')
	expect(issue_publication_state.labels_of(body, [PLANNED])).toEqual([PLANNED])
	expect(issue_publication_state.public_body(body)).toBe(BODY)
})

it('refuses corrupt and duplicate preparation records', () => {
	const body = issue_publication_state.prepare(BODY, LABELS)

	expect(() => issue_publication_state.prepare(body, LABELS)).toThrow('already contains')
	expect(issue_publication_state.is_pending('<!-- josh:publication broken')).toBe(true)
	expect(() => issue_publication_state.labels_of('<!-- josh:publication broken -->', [])).toThrow()
})

it('reads only a record line as pending, not the prefix quoted in prose or a code block', () => {
	const inline = 'The record starts with `<!-- josh:publication `.'
	const example = '<!-- josh:publication {"labels":["epic"]} -->'
	const quoted = `${BODY}\n\n${inline}\n\n\`\`\`\n${example}\n\`\`\`\n\n~~~~\n${example}\n~~~~`
	const prepared = issue_publication_state.prepare(quoted, ['run:lane'])

	expect(issue_publication_state.is_pending(quoted)).toBe(false)
	expect(issue_publication_state.is_pending(prepared)).toBe(true)
	expect(issue_publication_state.public_body(prepared)).toBe(quoted)
	expect(issue_publication_state.labels_of(prepared, [PLANNED])).toEqual([PLANNED])
})

it.each([
	['an unclosed fence', '```ts\nconst x = 1'],
	['a fence a different marker never closes', '````\n```\n~~~'],
])('still reads the record appended after %s', (_case, fence) => {
	const prepared = issue_publication_state.prepare(`${BODY}\n\n${fence}`, ['run:lane'])

	expect(issue_publication_state.is_pending(prepared)).toBe(true)
	expect(issue_publication_state.public_body(prepared)).toBe(`${BODY}\n\n${fence}`)
})

it('does not hold a published child that only quotes the record prefix', () => {
	const body = `${BODY}\n\nQuoting \`<!-- josh:publication \` in the background.`
	const child: EpicChild = {
		number: NUMBER,
		repo: REPO,
		state: 'OPEN',
		body,
		labels: [],
		blocked_by: [],
	}

	expect(epic_classify.classify_children([child]).time).toEqual([])
	expect(epic_classify.classify_children([child]).runnable).toEqual([child])
})

it('withholds a prepared standalone child even if auto-ok is applied manually', () => {
	const body = issue_publication_state.prepare(BODY, LABELS)
	const issue = { ...auto_ok_fixture.issue(NUMBER, CREATED_EARLIER), body }

	expect(auto_ok_cli.is_runnable(issue, new Map(), [])).toBe(false)
	expect(auto_ok_cli.pick_next([issue])).toBeUndefined()
})
