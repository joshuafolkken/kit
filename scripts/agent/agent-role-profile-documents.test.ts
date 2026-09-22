import { document_section } from '#scripts/document/document-section'
import { entry_read_set } from '#scripts/document/entry-read-set'
import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'

// The default agent profiles are the single source of the model and effort each unattended role runs
// with (joshuafolkken/kit#2095). The two workflow documents that quote them — `backlogrun-steps.md`
// and `backlogrun-child.md` — had drifted to the pre-#2095 `sonnet` worker, so a cost argument was
// read against a model the run never used (joshuafolkken/kit#2161). Derived from `DEFAULT_PROFILES` so
// a later profile change fails here until the prose is updated with it. joshuafolkken/kit#2190 moved
// the provider prose out of `backlogrun.md`'s session-cut section into `backlogrun-steps.md`.

const ROOT = process.cwd()
const PROFILES = agent_role_profile.DEFAULT_PROFILES
const BACKLOGRUN = 'backlogrun-steps.md'
const BACKLOGRUN_CHILD = 'backlogrun-child.md'

function unwrapped(file: string): string {
	const text = document_section.read_optional(entry_read_set.document_path(ROOT, file)) ?? ''

	return text.replaceAll(/\s+/gu, ' ')
}

describe('the workflow documents quote the default agent profiles', () => {
	const backlogrun = unwrapped(BACKLOGRUN)
	const child = unwrapped(BACKLOGRUN_CHILD)

	it('names every Anthropic role model that backlogrun-steps.md quotes', () => {
		expect(backlogrun).toContain(
			`scheduler \`${PROFILES.scheduler.model}\`, worker \`${PROFILES.worker.model}\` and reviewer \`${PROFILES.reviewer.model}\``,
		)
	})

	it('states the role efforts in scheduler / worker / reviewer order', () => {
		expect(backlogrun).toContain(
			`\`${PROFILES.scheduler.effort}\`/\`${PROFILES.worker.effort}\`/\`${PROFILES.reviewer.effort}\``,
		)
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
