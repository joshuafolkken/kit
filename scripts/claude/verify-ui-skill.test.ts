import { AI_DOCS, read_repo_file } from '#scripts/document/ai-document-fixture'
import { ui_shot } from '#scripts/ui/ui-shot'
import { describe, expect, it } from 'vitest'
import { read_skill_file } from './skill-fixture'

// #853: the completion gate named a `/verify` skill that this package did not ship, so the UI
// verification step pointed at nothing. The skill is distributed under `verify-ui` rather than
// `verify` on purpose: Claude Code bundles a `/verify` of its own, and a project skill at
// `.claude/skills/verify/` replaces it — and is the path that bundled skill records its own recipe
// into, which `josh sync` would then overwrite on every run.
const SKILL_DIRECTORY = '.claude/skills/verify-ui'
const SKILL_PATH = `${SKILL_DIRECTORY}/SKILL.md`
const SKILL_REFERENCE = '`/verify-ui`'

// Distribution (plugin, frontmatter, name, description) is held for every skill by
// `workflow-skills.test.ts`.

// The one behavior the issue called a requirement: a consumer whose application layer has no
// screenshot command must be told so. The fallback is entered on the line `ui:shot` prints when
// nothing resolved, so the skill quotes the command's own header — a reworded header turns this red
// rather than stranding the fallback.
describe(`${SKILL_PATH} — refuses to pass without a capture`, () => {
	it('quotes the header ui:shot prints when no command resolved', () => {
		const header = ui_shot.describe_missing([]).replace(/^ui:shot: /u, '')

		expect(read_skill_file(SKILL_DIRECTORY)).toContain(header)
	})
})

describe.each(AI_DOCS)('%s — UI gate names the shipped skill', (document_path) => {
	it('points at the skill this package distributes', () => {
		expect(read_repo_file(document_path)).toContain(SKILL_REFERENCE)
	})
})
