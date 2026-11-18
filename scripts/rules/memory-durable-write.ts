import { existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { edit_tool } from './edit-tool'

// The `memory-durable-write` row of `permission-guards.ts` (joshuafolkken/kit#7854): a `feedback`
// memory saved to Claude Code's auto MEMORY (`~/.claude/projects/<slug>/memory/`) is a durable rule kept
// where no other session or consumer reads it. `principles.md` → "durable-rules" says so, but Claude
// Code's own "save corrections and preferences" instruction outweighed the text, so the write is refused
// here. The other memory types (`user`, `project`, `reference`) and the `MEMORY.md` index are local
// context and pass. An `Edit` is judged by the file it leaves behind.
//
// It fires on every occurrence, for the reason `git-force.ts` does.

interface MemorySeam {
	home: string
	read: (file: string) => string
}

const { is_edit_tool, string_field, EDIT } = edit_tool
const FRONTMATTER = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/u
const FEEDBACK_TYPE = 'type: feedback'
const QUOTES = /["']/gu

function read_existing(file: string): string {
	return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

const DEFAULT_SEAM: MemorySeam = { home: os.homedir(), read: read_existing }

function is_memory_path(file: string, home: string): boolean {
	const relative = path.relative(path.join(home, '.claude', 'projects'), path.resolve(file))
	const [slug, directory, ...rest] = relative.split(path.sep)

	return slug !== '..' && slug !== '' && directory === 'memory' && rest.length > 0
}

function is_feedback(content: string): boolean {
	const body = FRONTMATTER.exec(content)?.groups?.['body']

	if (body === undefined) return false

	return body.split('\n').some((line) => line.replaceAll(QUOTES, '').trim() === FEEDBACK_TYPE)
}

function edited_content(input: Record<string, unknown>, before: string): string {
	const old_string = string_field(input, 'old_string')
	const new_string = string_field(input, 'new_string')

	if (input['replace_all'] === true) return before.split(old_string).join(new_string)

	const at = before.indexOf(old_string)

	if (at === -1) return before

	return before.slice(0, at) + new_string + before.slice(at + old_string.length)
}

function content_after(call: GuardedCall, file: string, seam: MemorySeam): string {
	if (!json_value.is_record(call.input)) return ''
	if (call.name !== EDIT) return string_field(call.input, 'content')

	return edited_content(call.input, seam.read(file))
}

function is_feedback_memory_edit(call: GuardedCall, seam: MemorySeam = DEFAULT_SEAM): boolean {
	if (!is_edit_tool(call.name) || !json_value.is_record(call.input)) return false

	const file = string_field(call.input, 'file_path')

	if (!is_memory_path(file, seam.home)) return false

	return is_feedback(content_after(call, file, seam))
}

const MEMORY_DURABLE_WRITE_REASON =
	'⛔ durable rule in MEMORY: a `type: feedback` memory is a durable rule, which belongs in the ' +
	'prompts/docs kit distributes, not in the auto MEMORY (`principles.md` → "durable-rules"). ' +
	'Propose the prompt/doc change instead — in a consultation, propose it; when the turn allows, file ' +
	'it. Keep MEMORY for machine-local context (`user`, `project`, `reference`). It fires on every ' +
	'occurrence.'

const ROW = {
	id: 'memory-durable-write',
	is_trigger: is_feedback_memory_edit,
	reason: MEMORY_DURABLE_WRITE_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Durable rule in MEMORY',
		topic: '`principles.md`',
		fires:
			'a `Write` or `Edit` under `~/.claude/projects/<slug>/memory/` that leaves a `type: feedback` frontmatter. Every occurrence',
		quiet:
			'the `user`, `project` and `reference` types, the `MEMORY.md` index, or a path outside `~/.claude/projects`',
	},
}

const memory_durable_write = { ROW, is_feedback_memory_edit, read_existing }

export type { MemorySeam }
export { memory_durable_write }
