import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file } from './ai-document-fixture'
import { init_logic } from './init/init-logic'
import { has_frontmatter, read_skill_file, skill_frontmatter } from './skill-fixture'

// #853: the completion gate named a `/verify` skill that this package did not ship, so the UI
// verification step pointed at nothing. The skill is distributed under `verify-ui` rather than
// `verify` on purpose: Claude Code bundles a `/verify` of its own, and a project skill at
// `.claude/skills/verify/` replaces it — and is the path that bundled skill records its own recipe
// into, which `josh sync` would then overwrite on every run.
const SKILL_DIRECTORY = '.claude/skills/verify-ui'
const SKILL_PATH = `${SKILL_DIRECTORY}/SKILL.md`
const SKILL_REFERENCE = '`/verify-ui`'

function read_skill(): string {
	return read_skill_file(SKILL_DIRECTORY)
}

describe(`${SKILL_PATH} — distribution`, () => {
	it('is copied into consumers as a directory', () => {
		expect(init_logic.get_ai_copy_directories()).toContain(SKILL_DIRECTORY)
	})

	it('opens with YAML frontmatter Claude Code can read', () => {
		expect(has_frontmatter(read_skill())).toBe(true)
	})

	it.each(['name: verify-ui', 'description:'])('declares %s', (field) => {
		expect(skill_frontmatter(read_skill())).toContain(field)
	})
})

// The one behavior the issue called a requirement: a consumer whose application layer has no
// screenshot command must be told so. A skill that quietly returned success there would leave the
// gate exactly as open as the missing skill did, while reading as closed.
describe(`${SKILL_PATH} — refuses to pass without a capture`, () => {
	it.each([
		'pnpm josh-app shot',
		'pnpm josh-game shot',
		'### When there is no screenshot command',
		'not** closed by this run',
		// The gate has to stay reachable while the toolkit command does not exist: a screenshot added
		// to a Playwright spec is committed test code, not an improvised script, so it is the fallback
		// rather than something the skill forbids.
		'await page.screenshot',
		'A failed capture is not a passed gate.',
		// Verified in a consumer: an installed toolkit without the subcommand and an absent toolkit both
		// exit non-zero with the same usage line, so only the printed command list separates them.
		'**Decide by the printed command list, not by whether the toolkit is installed.**',
		// Until app-kit#200 lands, every consumer takes the no-command branch — the skill has to say so
		// rather than read as broken.
		'Neither toolkit carries `shot` yet',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	it('does not offer a hand-rolled script as the fallback', () => {
		expect(read_skill()).toContain('Never stand up a preview server by hand')
	})

	it('requires the captured images to be opened, not merely produced', () => {
		expect(read_skill()).toContain('Read every produced image')
	})
})

describe.each(AI_DOCS)('%s — UI gate names the shipped skill', (document_path) => {
	const content = read_repo_file(document_path)

	it('points at the skill this package distributes', () => {
		expect(content).toContain(SKILL_REFERENCE)
	})

	// The gate used to name `/verify`, which this package does not ship and Claude Code bundles with
	// a broader meaning of its own; leaving the old name in place is what made the gate open-loop.
	it('no longer sends the reader to a skill this package does not ship', () => {
		expect(content).not.toContain('the `/verify` or `/run` skill')
	})

	it('keeps the gate reachable while no toolkit ships the command', () => {
		expect(content).toContain('adding a `page.screenshot()` to the relevant `*.e2e.ts`')
	})

	it('says a report of no capture is never a pass', () => {
		expect(content).toContain('That report is the answer, never a pass.')
	})
})
