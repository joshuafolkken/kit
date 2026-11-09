import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { epic_body } from './epic-body'

// The documents that present an epic's run command quote `epic_body.format_run_command`
// (joshuafolkken/kit#6817), so the terminal-runnable form cannot drift back to `backlogrun #<E>`,
// whose `#` a shell reads as the start of a comment.

const DOC_PLACEHOLDER = '<E>'
const CHAT_FORM = '`backlogrun #'
const NUMBER_AFTER_ONLY = /pnpm josh backlogrun [^`]*--only <[A-Z]>/u

const PRESENTING: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/kickoff.md',
	'.claude/skills/workflow-commands/split-assessment.md',
	'.claude/skills/workflow-commands/entry-sequence.md',
	'.claude/skills/workflow-commands/backlogrun.md',
	'.claude/skills/epic-commands/SKILL.md',
	'prompts/collaboration-workflow/issue-template.md',
	'docs/how-to/run-backlog.md',
	'docs/maintainers/epic-commands-rationale.md',
]

// The `--notify` option line is generated from `josh-commands-epic.ts` (joshuafolkken/kit#6823),
// so both carry the `Next:` line the Telegram sends.
const GENERATED = 'docs/josh-commands-backlog.md'
const NOTIFY_SOURCE = 'scripts/josh/josh-commands-epic.ts'
const NOTIFY_PRESENTING: ReadonlyArray<string> = [GENERATED, NOTIFY_SOURCE]
const SHELL_COMMENT_FORM = 'backlogrun #'

// Presents a terminal command but no epic run command, and also names the keyword a child brief
// carries, which no person types.
const CHILD_RUN = '.claude/skills/workflow-commands/backlogrun-child.md'

function unwrapped(file: string): string {
	return readFileSync(path.join(process.cwd(), file), 'utf8').replaceAll(/\s+/gu, ' ')
}

function run_command(): string {
	return epic_body
		.format_run_command(undefined)
		.split(epic_body.EPIC_PLACEHOLDER)
		.join(DOC_PLACEHOLDER)
}

describe('the documents present the terminal-runnable epic run command', () => {
	it.each([...PRESENTING, GENERATED])('%s quotes format_run_command', (file) => {
		expect(unwrapped(file)).toContain(run_command())
	})

	it.each(PRESENTING)('%s presents no backlogrun #', (file) => {
		expect(unwrapped(file)).not.toContain(CHAT_FORM)
	})

	it.each(NOTIFY_PRESENTING)('%s describes the --notify Next: line as the run command', (file) => {
		const text = unwrapped(file)

		expect(text).toContain(`Next: ${run_command()}`)
		expect(text).not.toContain(SHELL_COMMENT_FORM)
	})

	// `backlogrun-args.ts` reads a bare number as `#N` only before the first flag, so a number after
	// `--only` is refused.
	it.each([...PRESENTING, GENERATED, CHILD_RUN])('%s names every issue before --only', (file) => {
		expect(unwrapped(file)).not.toMatch(NUMBER_AFTER_ONLY)
	})
})
