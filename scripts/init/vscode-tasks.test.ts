import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { describe, expect, it } from 'vitest'
import { vscode_tasks } from './vscode-tasks'

const KIT_LABEL = 'josh: run board'
const KIT_TASK = { label: KIT_LABEL, command: 'pnpm josh run:board' }
const RETIRED_TASK = { label: 'josh: run event watch', command: 'pnpm josh run:event --watch' }
const OWN_TASK = { label: 'dev server', command: 'pnpm dev' }

function tasks_of(content: string): unknown {
	return parse_jsonc(content)['tasks']
}

describe('vscode_tasks.merge_tasks', () => {
	it('adds the kit task and the version to a file with no tasks', () => {
		const merged = vscode_tasks.merge_tasks('{}', [KIT_TASK])

		expect(tasks_of(merged)).toStrictEqual([KIT_TASK])
		expect(parse_jsonc(merged)['version']).toBe('2.0.0')
	})

	it('keeps a task the consumer declared under another label', () => {
		const existing = JSON.stringify({ version: '2.0.0', tasks: [OWN_TASK] })

		expect(tasks_of(vscode_tasks.merge_tasks(existing, [KIT_TASK]))).toStrictEqual([
			OWN_TASK,
			KIT_TASK,
		])
	})

	it('replaces a task carrying the kit label in place', () => {
		const stale = { label: KIT_LABEL, command: 'old' }
		const existing = JSON.stringify({ version: '2.0.0', tasks: [stale, OWN_TASK] })

		expect(tasks_of(vscode_tasks.merge_tasks(existing, [KIT_TASK]))).toStrictEqual([
			KIT_TASK,
			OWN_TASK,
		])
	})

	it('returns the content unchanged when the kit task is already current', () => {
		const existing = `{\n\t// own comment\n\t"version": "2.0.0",\n\t"tasks": [${JSON.stringify(KIT_TASK)}]\n}\n`

		expect(vscode_tasks.merge_tasks(existing, [KIT_TASK])).toBe(existing)
	})

	it('keeps the consumer comments when it adds the kit task', () => {
		const existing = '{\n\t// own comment\n\t"version": "2.0.0"\n}\n'

		expect(vscode_tasks.merge_tasks(existing, [KIT_TASK])).toContain('// own comment')
	})
})

describe('vscode_tasks.merge_tasks — consumer tasks array', () => {
	it('keeps a comment inside the consumer tasks array when it adds the kit task', () => {
		const existing = `{\n\t"version": "2.0.0",\n\t"tasks": [\n\t\t// my dev server\n\t\t${JSON.stringify(OWN_TASK)}\n\t]\n}\n`
		const merged = vscode_tasks.merge_tasks(existing, [KIT_TASK])

		expect(merged).toContain('// my dev server')
		expect(tasks_of(merged)).toStrictEqual([OWN_TASK, KIT_TASK])
	})

	it('keeps the consumer tasks when the array also holds a non-object entry', () => {
		const existing = JSON.stringify({ version: '2.0.0', tasks: [OWN_TASK, 'oops'] })

		expect(tasks_of(vscode_tasks.merge_tasks(existing, [KIT_TASK]))).toStrictEqual([
			OWN_TASK,
			'oops',
			KIT_TASK,
		])
	})
})

// joshuafolkken/kit#3438: the folder-open watch became the board; appending would open both panes.
describe('vscode_tasks.merge_tasks — a retired kit label', () => {
	it('replaces a task carrying a retired kit label with its successor in place', () => {
		const existing = JSON.stringify({ version: '2.0.0', tasks: [RETIRED_TASK, OWN_TASK] })

		expect(tasks_of(vscode_tasks.merge_tasks(existing, [KIT_TASK]))).toStrictEqual([
			KIT_TASK,
			OWN_TASK,
		])
	})
})

describe('vscode_tasks.read_kit_tasks', () => {
	it('reads the tasks array, and nothing when it is absent', () => {
		expect(vscode_tasks.read_kit_tasks(JSON.stringify({ tasks: [KIT_TASK] }))).toStrictEqual([
			KIT_TASK,
		])
		expect(vscode_tasks.read_kit_tasks('{}')).toStrictEqual([])
	})
})
