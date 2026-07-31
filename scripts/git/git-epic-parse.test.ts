import { describe, expect, it } from 'vitest'
import {
	has_child,
	has_external_task_list_entry,
	is_state_closed,
	parse_task_list_issue_numbers,
} from './git-epic-parse'

const PARSE_CASES = [
	{
		label: 'extracts unchecked and checked entries alike',
		body: '## Progress\n\n- [ ] #101 first\n- [x] #102 second\n- [X] #103 third\n',
		expected: [101, 102, 103],
	},
	{
		label: 'ignores bare issue references outside a task list',
		body: 'Depends on #55 and relates to #56.\n\n- [ ] #101 tracked\n',
		expected: [101],
	},
	{
		label: 'ignores task list entries with no issue reference',
		body: '- [ ] write the docs\n- [x] #101 tracked\n',
		expected: [101],
	},
	{
		label: 'accepts asterisk and plus markers with leading indentation',
		body: '  * [ ] #101 one\n\t+ [x] #102 two\n',
		expected: [101, 102],
	},
	{
		label: 'deduplicates repeated issue numbers',
		body: '- [ ] #101 one\n- [x] #101 duplicate\n',
		expected: [101],
	},
	{
		label: 'returns nothing for a body with no task list',
		body: '## Split rationale\n\nNothing tracked here.',
		expected: [],
	},
	{ label: 'returns nothing when the body is undefined', body: undefined, expected: [] },
	{
		label: 'ignores sample rows inside a fenced code block',
		body: '## Template\n\n```md\n- [ ] #901 sample\n- [ ] #902 sample\n```\n\n- [ ] #101 real\n',
		expected: [101],
	},
	{
		label: 'ignores sample rows inside a tilde-fenced block',
		body: '~~~\n- [ ] #901 sample\n~~~\n\n- [ ] #101 real\n',
		expected: [101],
	},
	{
		label: 'still reads entries that follow a closed fenced block',
		body: '```ts\nconst a = 1\n```\n\n- [ ] #101 one\n- [x] #102 two\n',
		expected: [101, 102],
	},
] as const satisfies ReadonlyArray<{
	label: string
	body: string | undefined
	expected: ReadonlyArray<number>
}>

describe('parse_task_list_issue_numbers', () => {
	it.each(PARSE_CASES)('$label', ({ body, expected }) => {
		expect(parse_task_list_issue_numbers(body)).toEqual(expected)
	})
})

const EXTERNAL_CASES = [
	{
		label: 'detects an owner/repo qualified task list entry',
		body: '- [ ] #101 local\n- [ ] joshuafolkken/app-kit#7 remote\n',
		expected: true,
	},
	{
		label: 'detects a full-URL task list entry',
		body: '- [ ] https://github.com/joshuafolkken/app-kit/issues/7\n',
		expected: true,
	},
	{
		label: 'reports none for a purely local task list',
		body: '- [ ] #101 one\n- [x] #102 two\n',
		expected: false,
	},
	{
		label: 'ignores a repo-qualified reference outside a task list',
		body: 'See joshuafolkken/app-kit#7 for context.\n\n- [ ] #101 one\n',
		expected: false,
	},
	{ label: 'reports none when the body is undefined', body: undefined, expected: false },
	{
		label: 'ignores a repo-qualified sample inside a fenced code block',
		body: '```md\n- [ ] owner/repo#7 sample\n```\n\n- [ ] #101 real\n',
		expected: false,
	},
] as const satisfies ReadonlyArray<{ label: string; body: string | undefined; expected: boolean }>

describe('has_external_task_list_entry', () => {
	it.each(EXTERNAL_CASES)('$label', ({ body, expected }) => {
		expect(has_external_task_list_entry(body)).toBe(expected)
	})
})

describe('has_child', () => {
	it('reports membership of the merged issue in the task list', () => {
		expect(has_child([101, 102], 102)).toBe(true)
		expect(has_child([101, 102], 999)).toBe(false)
		expect(has_child([], 101)).toBe(false)
	})
})

describe('is_state_closed', () => {
	it.each([
		{ state: 'CLOSED', expected: true },
		{ state: 'closed', expected: true },
		{ state: 'OPEN', expected: false },
		{ state: undefined, expected: false },
	])('maps state $state to $expected', ({ state, expected }) => {
		expect(is_state_closed(state)).toBe(expected)
	})
})
