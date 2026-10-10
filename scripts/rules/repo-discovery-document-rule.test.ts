import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { ENV_EXAMPLE, read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#869: the repository map decides which local checkout other commands write to,
// and the one rule that keeps those writes off someone else's repository — only the current
// repository's own owner is ever mapped — is not visible in the map itself. A developer learns it
// exists from the rule document and the command reference, so a row present in one and missing from
// the other leaves the tool unable to explain it. The env sample is where a new project copies its
// `.env` from.
const JOSH_COMMANDS_DOC = 'docs/josh-commands.md'

// The owner restriction and its non-overridability are pinned literally: they are the part most
// easily softened into "prefers the same owner" during a reword, and softening them is exactly the
// change that would make the variable unsafe.
//
// joshuafolkken/kit#1720: they are pinned at the command reference rather than in the AI document.
// The restriction is enforced in code (`repo_map_logic.is_same_owner`) and the agent-facing rule it
// serves — a repository we do not own is Tier C — is resident under "Communication", so the prose
// here described behavior rather than instructing anyone: the residency criterion
// (`.claude/skills/workflow-commands/SKILL.md` → §3) leaves the row resident and moves the body to
// the command reference the section lead already links to. Nothing was deleted; the assertions moved
// with the text.
//
// joshuafolkken/kit#1924 slimmed the Environment Variables table to prose, so the resident mention is
// now the variable name in the `.env` sentence rather than a table row — the rule still names it, and
// the owner-restriction body stays at the command reference below.
//
// joshuafolkken/kit#3395 took that sentence out of `CLAUDE.md`: the variable is read only when a
// project is configured, so it is documented in the environment-variable reference alone.
const ENV_DOC = 'docs/environment-variables.md'
const ENV_DOC_MARKERS: ReadonlyArray<string> = ['`JOSH_REPO_PATHS`']

const COMMAND_DOC_MARKERS: ReadonlyArray<string> = [
	'#### The discovered repository map',
	'**The owner restriction is unconditional and cannot be overridden.**',
	'**The directory name is never used as the repository name**',
	'Remotes on any host other than GitHub are excluded before the owner is even compared',
	'an override naming a different owner is dropped exactly like a discovered sibling would be',
]

describe('repository map documentation', () => {
	it('documents the override variable in the environment-variable reference', () => {
		const content = read_repo_file(ENV_DOC)

		for (const marker of ENV_DOC_MARKERS) expect(content).toContain(marker)
	})

	it('offers the variable in the env sample a new project copies', () => {
		expect(read_repo_file(ENV_EXAMPLE)).toContain(`${repo_discovery.OVERRIDE_ENV_KEY}=`)
	})

	it('documents the discovery rules under josh doctor', () => {
		const content = read_repo_file(JOSH_COMMANDS_DOC)

		for (const marker of COMMAND_DOC_MARKERS) expect(content).toContain(marker)
	})
})
