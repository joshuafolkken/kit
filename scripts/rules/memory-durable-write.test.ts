import { describe, expect, it } from 'vitest'
import { memory_durable_write, type MemorySeam } from './memory-durable-write'

// joshuafolkken/kit#7854: a `feedback` memory written to Claude Code's auto MEMORY is refused; the
// other types, the index and a same-named path inside a project pass. Home and the file read are
// injected, so no test touches the real MEMORY.

const HOME = '/Users/someone'
const MEMORY = `${HOME}/.claude/projects/-work-app/memory`
const FEEDBACK = '---\nname: x\ndescription: y\ntype: feedback\n---\n\nbody\n'
const NESTED_FEEDBACK = '---\nname: x\nmetadata:\n  type: "feedback"\n---\n\nbody\n'
const PROJECT = '---\nname: x\nmetadata:\n  type: project\n---\n\nbody\n'

function seam_with(existing: string): MemorySeam {
	return { home: HOME, read: (): string => existing }
}

function write_call(file_path: string, content: string): { name: string; input: object } {
	return { name: 'Write', input: { file_path, content } }
}

function is_refused(call: { name: string; input: object }, existing = ''): boolean {
	return memory_durable_write.is_feedback_memory_edit(call, seam_with(existing))
}

describe('memory_durable_write.is_feedback_memory_edit — Write', () => {
	it.each([FEEDBACK, NESTED_FEEDBACK])('refuses a feedback memory %#', (content) => {
		expect(is_refused(write_call(`${MEMORY}/feedback_rule.md`, content))).toBe(true)
	})

	it.each(['user', 'project', 'reference'])('passes a %s memory', (type) => {
		const content = `---\nname: x\ntype: ${type}\n---\n\nbody\n`

		expect(is_refused(write_call(`${MEMORY}/note.md`, content))).toBe(false)
	})

	it('passes the MEMORY.md index', () => {
		const index = '# Memory Index\n\n- [Rule](feedback_rule.md) — type: feedback\n'

		expect(is_refused(write_call(`${MEMORY}/MEMORY.md`, index))).toBe(false)
	})

	it.each([
		'/work/app/.claude/projects/-work-app/memory/feedback_rule.md',
		`${HOME}/.claude/projects/memory`,
		`${HOME}/notes/feedback_rule.md`,
	])('passes a feedback file outside the auto MEMORY: %j', (file) => {
		expect(is_refused(write_call(file, FEEDBACK))).toBe(false)
	})

	it('passes a Read of a feedback memory', () => {
		const call = { name: 'Read', input: { file_path: `${MEMORY}/feedback_rule.md` } }

		expect(is_refused(call, FEEDBACK)).toBe(false)
	})
})

const TYPE_PROJECT = 'type: project'
const TYPE_FEEDBACK = 'type: feedback'

function edit_call(old_string: string, new_string: string, replace_all = false): object {
	return { file_path: `${MEMORY}/note.md`, old_string, new_string, replace_all }
}

describe('memory_durable_write.is_feedback_memory_edit — Edit', () => {
	it('refuses an Edit that turns a memory into feedback', () => {
		const call = { name: 'Edit', input: edit_call(TYPE_PROJECT, TYPE_FEEDBACK) }

		expect(is_refused(call, PROJECT)).toBe(true)
	})

	it('refuses a replace_all Edit of a feedback memory body', () => {
		const call = { name: 'Edit', input: edit_call('body', 'rule', true) }

		expect(is_refused(call, NESTED_FEEDBACK)).toBe(true)
	})

	it('passes an Edit that turns feedback into a project memory', () => {
		const call = { name: 'Edit', input: edit_call(TYPE_FEEDBACK, TYPE_PROJECT) }

		expect(is_refused(call, FEEDBACK)).toBe(false)
	})
})

describe('memory_durable_write.ROW', () => {
	it('points the refusal at "durable-rules" and asks for a prompt/doc change', () => {
		expect(memory_durable_write.ROW.reason).toContain('"durable-rules"')
		expect(memory_durable_write.ROW.reason).toContain('Propose the prompt/doc change')
	})
})
