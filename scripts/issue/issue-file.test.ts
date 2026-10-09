import { describe, expect, it } from 'vitest'
import { issue_file, type FileArguments } from './issue-file'

// joshuafolkken/kit#2808: the decisions `josh issue:file` makes before it sends anything — the
// arguments it accepts, the labels one create call carries, the `## Origin` a cross-repository filing
// owes, and which duplicate candidates still hold the filing.

const TITLE = 'Add a command that files an Issue'
const BODY_FILE = 'body.md'
const HERE = 'joshuafolkken/kit'
const THERE = 'joshuafolkken/app-kit'
const ENHANCEMENT_BODY = '## 背景\n\n- 種別: 非不具合\n- 目的: 機能追加\n'
const DUPLICATE_A = 2801
const DUPLICATE_B = 2795
const BODY_FLAG = '--body-file'
const DEPTH_FLAG = '--depth'
const ROUTE_FLAG = '--route'
const DISTINCT_FLAG = '--distinct'
const EPIC = 'epic'
const TIER_A = 'route:tier-a'
const WITH_BODY = [TITLE, BODY_FLAG, BODY_FILE]
const FILED = [...WITH_BODY, DEPTH_FLAG, '1']
const REFUSES = 'refuses %s'

function args_of(overrides: Partial<FileArguments> = {}): FileArguments {
	return {
		title: TITLE,
		body_file: BODY_FILE,
		depth: 'depth:1',
		route: undefined,
		labels: [],
		repo: undefined,
		distinct: [],
		is_over_cap: false,
		is_auto_ok_opted_out: false,
		is_requested: false,
		is_release: false,
		...overrides,
	}
}

describe('issue_file.parse — the arguments a filing owes', () => {
	it('reads the title, body file and depth', () => {
		expect(issue_file.parse(FILED)).toStrictEqual(args_of())
	})

	it('reads the route, extra labels, target repository and distinct candidates', () => {
		const distinct = `${String(DUPLICATE_A)},#${String(DUPLICATE_B)}`
		const argv = [...WITH_BODY, DEPTH_FLAG, 'depth:0', ROUTE_FLAG, 'tier-a', '--label', EPIC]
		const parsed = issue_file.parse([...argv, '--repo', THERE, DISTINCT_FLAG, distinct])
		const expected = { depth: 'depth:0', route: TIER_A, labels: [EPIC], repo: THERE }

		expect(parsed).toStrictEqual(args_of({ ...expected, distinct: [DUPLICATE_A, DUPLICATE_B] }))
	})

	it('reads --over-cap', () => {
		expect(issue_file.parse([...FILED, '--over-cap'])).toStrictEqual(args_of({ is_over_cap: true }))
	})

	it('reads --no-auto-ok', () => {
		const parsed = issue_file.parse([...FILED, '--no-auto-ok'])

		expect(parsed).toStrictEqual(args_of({ is_auto_ok_opted_out: true }))
	})

	it('reads --release', () => {
		expect(issue_file.parse([...FILED, '--release'])).toStrictEqual(args_of({ is_release: true }))
	})

	it.each([
		['no depth', WITH_BODY],
		['an unknown depth', [...WITH_BODY, DEPTH_FLAG, '3']],
		['no body file', [TITLE, DEPTH_FLAG, '1']],
		['no title', [BODY_FLAG, BODY_FILE, DEPTH_FLAG, '1']],
		['an unknown route', [...FILED, ROUTE_FLAG, 'x']],
		['a malformed distinct', [...FILED, DISTINCT_FLAG, 'x']],
		['an unknown flag', [...FILED, '--nope']],
	])(REFUSES, (_label, argv) => {
		expect(issue_file.parse(argv)).toBeUndefined()
	})
})

// joshuafolkken/kit#3614: a filing a person asked for declares it, so the run's opt-in does not apply.
describe('issue_file.parse — a filing a person requested', () => {
	it('reads --requested', () => {
		const parsed = issue_file.parse([...FILED, '--requested'])

		expect(parsed).toStrictEqual(args_of({ is_requested: true }))
	})
})

describe('issue_file.labels_of — every label in one create call', () => {
	it('carries the depth, the route, the declared classification and the extra labels', () => {
		const args = args_of({ route: TIER_A, labels: [EPIC] })

		expect(issue_file.labels_of(args, ENHANCEMENT_BODY)).toStrictEqual([
			'depth:1',
			TIER_A,
			EPIC,
			'enhancement',
		])
	})

	it('does not repeat a classification label already given', () => {
		const args = args_of({ labels: ['Enhancement'] })

		expect(issue_file.labels_of(args, ENHANCEMENT_BODY)).toStrictEqual(['depth:1', 'Enhancement'])
	})

	it('drops a classification label the body does not declare', () => {
		const args = args_of({ labels: ['Bug', EPIC] })

		expect(issue_file.labels_of(args, ENHANCEMENT_BODY)).toStrictEqual([
			'depth:1',
			EPIC,
			'enhancement',
		])
	})
})

describe('issue_file.triage_problem — the run label an auto-ok filing owes', () => {
	it('refuses auto-ok with neither run:lane nor run:solo', () => {
		expect(issue_file.triage_problem(['depth:1', 'auto-ok'])).toContain('--label run:lane')
	})

	it.each([['run:lane'], ['run:solo'], ['Run:Lane']])('accepts auto-ok with %s', (label) => {
		expect(issue_file.triage_problem(['depth:1', 'auto-ok', label])).toBeUndefined()
	})

	it('leaves a filing without auto-ok as it was', () => {
		expect(issue_file.triage_problem(['depth:1', 'bug'])).toBeUndefined()
	})
})

describe('issue_file.origin_problem — the backlink a cross-repository filing owes', () => {
	it('asks nothing of a filing into this repository', () => {
		expect(issue_file.origin_problem('', HERE, HERE)).toBeUndefined()
	})

	it('compares repositories case-insensitively', () => {
		expect(issue_file.origin_problem('', 'JoshuaFolkken/Kit', HERE)).toBeUndefined()
	})

	it.each([
		['a qualified reference', `## Origin\n\n${THERE}#230\n`],
		['an issue URL', `## Origin\n\nhttps://github.com/${THERE}/issues/230\n`],
		['a reference with prose attached', `## Origin\n\n起票元は ${THERE}#230。\n`],
		['a parenthesized reference', `## Origin\n\n- found in (${THERE}#230)\n`],
	])('accepts %s under the heading', (_label, body) => {
		expect(issue_file.origin_problem(body, HERE, THERE)).toBeUndefined()
	})

	it.each([
		['no section', '## 背景\n'],
		['a bare number', '## Origin\n\n#230\n'],
		['a reference outside the section', `## 背景\n\n${THERE}#230\n\n## Origin\n\nnone\n`],
	])(REFUSES, (_label, body) => {
		expect(issue_file.origin_problem(body, HERE, THERE)).toContain('## Origin')
	})
})

describe('issue_file.unacknowledged — the candidates still holding the filing', () => {
	it('holds every candidate not declared separate', () => {
		expect(issue_file.unacknowledged([DUPLICATE_A, DUPLICATE_B], [DUPLICATE_A])).toStrictEqual([
			DUPLICATE_B,
		])
	})

	it('holds nothing once every candidate is declared separate', () => {
		expect(issue_file.unacknowledged([DUPLICATE_A], [DUPLICATE_A])).toStrictEqual([])
	})
})
