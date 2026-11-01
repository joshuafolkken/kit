import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { package_file, read_skill_file } from './skill-fixture'

const WORKFLOW_SKILL = '.claude/skills/workflow-commands'
const RAW_STASH_PUSH = 'git stash push'

// joshuafolkken/kit#2919: a `new` entry stashed the primary checkout's ledger lines with the other
// pre-existing changes, and the batch-end flush, reading `git status`, never saw them again.
// joshuafolkken/kit#4131: the skills then pushed in two forms, one keeping the ledger and dropping
// untracked files, the other the reverse. Both rules now live in `josh stash:push`
// (`stash-push-cli.test.ts` pins its paths against real git), and a `new` entry's stash is
// `run:entry --adopt`'s (joshuafolkken/kit#5747), so a skill never pushes one in its own form.
const SKILL_FILES = readdirSync(package_file(WORKFLOW_SKILL)).filter((name) => name.endsWith('.md'))

describe(`${WORKFLOW_SKILL} — the stash`, () => {
	it.each(SKILL_FILES)('%s never stashes with a raw git stash push', (filename) => {
		expect(read_skill_file(WORKFLOW_SKILL, filename)).not.toContain(RAW_STASH_PUSH)
	})
})
