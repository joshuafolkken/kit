import { describe, expect, it } from 'vitest'
import { AI_DOCS, ENV_EXAMPLE, read_repo_file } from './ai-document-fixture'
import { repo_discovery } from './discovery/repo-discovery'

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
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'| `JOSH_REPO_PATHS`',
	'The owner restriction is unconditional and cannot be overridden',
	'an entry naming a different owner is dropped',
	'never by its directory name',
]

const COMMAND_DOC_MARKERS: ReadonlyArray<string> = [
	'#### The discovered repository map',
	'**The owner restriction is unconditional and cannot be overridden.**',
	'**The directory name is never used as the repository name**',
	'Remotes on any host other than GitHub are excluded before the owner is even compared',
]

describe('repository map documentation', () => {
	it.each(AI_DOCS)('documents the override variable in %s', (document_name) => {
		const content = read_repo_file(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it('offers the variable in the env sample a new project copies', () => {
		expect(read_repo_file(ENV_EXAMPLE)).toContain(`${repo_discovery.OVERRIDE_ENV_KEY}=`)
	})

	it('documents the discovery rules under josh doctor', () => {
		const content = read_repo_file(JOSH_COMMANDS_DOC)

		for (const marker of COMMAND_DOC_MARKERS) expect(content).toContain(marker)
	})
})
