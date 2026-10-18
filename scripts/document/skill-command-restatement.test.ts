import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Skills and prompts point at the josh command that already does a step, rather than restating the
// step as a manual procedure the agent repeats (#4129).

const WORKFLOW = '.claude/skills/workflow-commands'
const PROMPT_ROOTS = ['.claude/skills', 'prompts']
const LABEL_CREATION = 'labels -f name='
const POST_MERGE_SYNC = /after the merge, run `pnpm josh ms`|run `pnpm josh ms` after/iu
const EPIC_FALLBACK = "'labels[]=epic'"
const ISSUE_TEMPLATE = 'prompts/collaboration-workflow/issue-template.md'
const MARKDOWN = '.md'

function markdown_under(root: string): ReadonlyArray<string> {
	const entries = readdirSync(root, { recursive: true, encoding: 'utf8' })

	return entries.filter((entry) => entry.endsWith(MARKDOWN)).map((entry) => `${root}/${entry}`)
}

function read(path: string): string {
	return readFileSync(path, 'utf8')
}

const PROSE_FILES = PROMPT_ROOTS.flatMap((root) => markdown_under(root))

describe('skill and prompt prose defers to the josh commands', () => {
	it('never restates label creation, which josh sync owns', () => {
		const offenders = PROSE_FILES.filter((path) => read(path).includes(LABEL_CREATION))

		expect(offenders).toStrictEqual([])
	})

	it.each(['followup.md', 'fullrun-steps.md', 'fullrun.md'])(
		'%s leaves the post-merge sync to run:tail',
		(file) => {
			expect(read(`${WORKFLOW}/${file}`)).not.toMatch(POST_MERGE_SYNC)
		},
	)

	it('keeps the epic fallback without josh in issue-template.md alone', () => {
		const holders = PROSE_FILES.filter((path) => read(path).includes(EPIC_FALLBACK))

		expect(holders).toStrictEqual([ISSUE_TEMPLATE])
	})
})
