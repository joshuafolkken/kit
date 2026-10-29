import { describe, expect, it } from 'vitest'
import { broad_investigation } from './broad-investigation'

// joshuafolkken/kit#5351: which tool calls are broad investigation. The shell half has its own test
// (`broad-investigation-shell.test.ts`); this one covers the tools and the dispatches.

const { READ_LINE_CAP, is_broad_investigation, is_delegated_investigation } = broad_investigation
const ONE_FILE = 'package.json'
const PROMPT = 'Find where the guard reads the transcript'

function dispatch(input: Record<string, unknown>): { name: string; input: unknown } {
	return { name: 'Agent', input: { prompt: PROMPT, ...input } }
}

describe('broad_investigation.is_broad_investigation — the broad', () => {
	it.each([
		['a `Glob`', { name: 'Glob', input: { pattern: '**/*.ts' } }],
		['a `WebFetch`', { name: 'WebFetch', input: { url: 'https://example.com' } }],
		['a `Read` with no limit', { name: 'Read', input: { file_path: ONE_FILE } }],
		[
			'a `Read` past the cap',
			{ name: 'Read', input: { file_path: ONE_FILE, limit: READ_LINE_CAP + 1 } },
		],
		['a `Grep` with no path', { name: 'Grep', input: { pattern: 'guard' } }],
		['a `Grep` of a directory', { name: 'Grep', input: { pattern: 'guard', path: 'scripts' } }],
		['a tree search in `Bash`', { name: 'Bash', input: { command: 'grep -rn guard scripts' } }],
		['a dispatch with no type', dispatch({})],
		['an `Explore` on Fable', dispatch({ subagent_type: 'Explore', model: 'fable' })],
		['a `general-purpose` on the Fable id', dispatch({ model: 'claude-fable-5-1' })],
		['the published `Task` spelling', { name: 'Task', input: { subagent_type: 'Explore' } }],
	])('flags %s', (_case, call) => {
		expect(is_broad_investigation(call)).toBe(true)
	})
})

describe('broad_investigation.is_broad_investigation — the narrow', () => {
	it.each([
		[
			'a `Read` within the cap',
			{ name: 'Read', input: { file_path: ONE_FILE, limit: READ_LINE_CAP } },
		],
		['a `Grep` of one file', { name: 'Grep', input: { pattern: 'guard', path: ONE_FILE } }],
		['a narrow `Bash`', { name: 'Bash', input: { command: `grep -n guard ${ONE_FILE}` } }],
		['an investigator on its definition model', dispatch({ subagent_type: 'investigator' })],
		['the consumer spelling', dispatch({ subagent_type: 'kit:investigator' })],
		['an `Explore` on opus', dispatch({ subagent_type: 'Explore', model: 'opus' })],
		['a reviewer dispatch', dispatch({ subagent_type: 'reviewer' })],
		['an `Edit`', { name: 'Edit', input: { file_path: ONE_FILE } }],
	])('lets %s through', (_case, call) => {
		expect(is_broad_investigation(call)).toBe(false)
	})
})

describe('broad_investigation.is_delegated_investigation — the kept form', () => {
	it.each([
		['the investigator unit', dispatch({ subagent_type: 'investigator' })],
		['an `Explore` on sonnet', dispatch({ subagent_type: 'Explore', model: 'sonnet' })],
		['a `general-purpose` on opus', dispatch({ model: 'opus' })],
	])('counts %s', (_case, call) => {
		expect(is_delegated_investigation(call)).toBe(true)
	})

	it.each([
		['a dispatch inheriting the model', dispatch({})],
		['an `Explore` named Fable', dispatch({ subagent_type: 'Explore', model: 'fable' })],
		['a reviewer on opus', dispatch({ subagent_type: 'reviewer', model: 'opus' })],
		['a `Read`', { name: 'Read', input: { file_path: ONE_FILE } }],
	])('does not count %s', (_case, call) => {
		expect(is_delegated_investigation(call)).toBe(false)
	})
})
