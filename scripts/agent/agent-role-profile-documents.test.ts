import path from 'node:path'
import { document_section } from '#scripts/document/document-section'
import { entry_read_set } from '#scripts/document/entry-read-set'
import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'

// The default agent profiles are the single source of the model and effort each unattended role runs
// with (joshuafolkken/kit#2095). The two workflow documents that quote them — `backlogrun-steps.md`
// and `backlogrun-child.md` — had drifted to the pre-#2095 `sonnet` worker, so a cost argument was
// read against a model the run never used (joshuafolkken/kit#2161). Derived from `DEFAULT_PROFILES` so
// a later profile change fails here until the prose is updated with it. joshuafolkken/kit#3175 moved
// the provider table out of `backlogrun-steps.md` into `docs/josh-commands-automation.md` →
// "`josh run:wake`", read only when the supervisor is asked about.

const ROOT = process.cwd()
const PROFILES = agent_role_profile.DEFAULT_PROFILES
const BACKLOGRUN = 'backlogrun-steps.md'
const BACKLOGRUN_CHILD = 'backlogrun-child.md'
const AUTOMATION_DOC = path.join(ROOT, 'docs', 'josh-commands-automation.md')

function unwrapped_at(file_path: string): string {
	return (document_section.read_optional(file_path) ?? '').replaceAll(/\s+/gu, ' ')
}

function unwrapped(file: string): string {
	return unwrapped_at(entry_read_set.document_path(ROOT, file))
}

describe('the workflow documents quote the default agent profiles', () => {
	const backlogrun = unwrapped(BACKLOGRUN)
	const child = unwrapped(BACKLOGRUN_CHILD)
	const automation = unwrapped_at(AUTOMATION_DOC)

	it('names every Anthropic role model and effort in the provider table', () => {
		expect(automation).toContain(
			`| Anthropic | \`${PROFILES.scheduler.model}\` / \`${PROFILES.scheduler.effort}\` | \`${PROFILES.worker.model}\` / \`${PROFILES.worker.effort}\` | \`${PROFILES.reviewer.model}\` / \`${PROFILES.reviewer.effort}\` |`,
		)
	})

	it('orders the provider table columns scheduler / worker / reviewer', () => {
		expect(automation).toContain('| Provider | scheduler | worker | reviewer |')
	})

	it('states the worker default that backlogrun-child.md quotes', () => {
		expect(child).toContain(
			`Anthropic \`${PROFILES.worker.model}\` / \`${PROFILES.worker.effort}\``,
		)
	})

	it('brings back no pre-#2095 sonnet worker', () => {
		expect(backlogrun).not.toContain('worker `sonnet`')
		expect(child).not.toContain('sonnet')
	})
})
