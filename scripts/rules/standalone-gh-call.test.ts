import { describe, expect, it } from 'vitest'
import { standalone_gh_call } from './standalone-gh-call'

// joshuafolkken/kit#7330: a line that is one `gh issue <action> <N> …` call alone, the shape a refusing
// row may rewrite. Shell syntax anywhere, or anything but exactly one issue number, is not one.

const VIEW = ['gh', 'issue', 'view']

describe('standalone_gh_call.call_of', () => {
	it.each([
		['gh issue view 7', { issue: '7', flags: '' }],
		['  gh issue view 7 -R o/r  ', { issue: '7', flags: '-R o/r' }],
		['gh issue view --repo=o/r 7', { issue: '7', flags: '--repo=o/r' }],
	])('reads %j as %j', (line, call) => {
		expect(standalone_gh_call.call_of(line, VIEW)).toEqual(call)
	})

	it.each([
		'gh issue comment 7',
		'gh issue view',
		'gh issue view 7 8',
		'gh issue view 07',
		'gh issue view 7 | head',
		'gh issue view 7 > out.txt',
		'gh issue view "7"',
		'gh issue view $N',
		'echo gh issue view 7',
	])('reads %j as no standalone call', (line) => {
		expect(standalone_gh_call.call_of(line, VIEW)).toBeUndefined()
	})
})

describe('standalone_gh_call.input_of', () => {
	it('replaces the Bash command and keeps the other fields', () => {
		const call = { name: 'Bash', input: { command: 'a', description: 'd' } }

		expect(standalone_gh_call.input_of(call, () => 'b')).toEqual({ command: 'b', description: 'd' })
	})

	it('answers undefined for another tool, or where the command has no rewrite', () => {
		const command = { command: 'a' }

		expect(standalone_gh_call.input_of({ name: 'Read', input: command }, () => 'b')).toBeUndefined()
		expect(
			standalone_gh_call.input_of({ name: 'Bash', input: command }, () => undefined),
		).toBeUndefined()
	})
})
