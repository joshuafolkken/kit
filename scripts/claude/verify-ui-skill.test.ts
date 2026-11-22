import { AI_DOCS, read_repo_file } from '#scripts/document/ai-document-fixture'
import { run_board_frame_preview } from '#scripts/run/board/run-board-frame-preview'
import { run_board_sound_transition } from '#scripts/run/board/run-board-sound-transition'
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

	// joshuafolkken/kit#8502: an issue that deferred its look past the merge continues without a
	// capture, but the branch records the look as unchecked and never reports the gate satisfied.
	it('continues on run:prep post_merge_check with the look unchecked', () => {
		const skill = read_skill_file(SKILL_DIRECTORY)

		expect(skill).toContain('`post_merge_check: <where to look>`')
		expect(skill).toContain('`behavior checked, look unchecked`')
		expect(skill).toContain('This does not close the gate; never report it as\nsatisfied.')
	})
})

// joshuafolkken/kit#8435: the board is terminal text, so its display change closes the gate by
// reading fixed-state frames rather than stopping for a capture kit has no command for.
describe(`${SKILL_PATH} — terminal UI path`, () => {
	const skill = read_skill_file(SKILL_DIRECTORY)

	it('routes a board display change to the frame read without stopping', () => {
		expect(skill).toContain('(`scripts/run/board/`)\ntakes the Terminal UI section')
		expect(skill).toContain('`pnpm josh run:board --frame`')
		expect(skill).toContain('do not look for a screenshot command, and do not stop.')
	})

	// A flag the skill names that `run:board --frame` does not take sends the reader to a refused run.
	it.each(['--notice', '--issue', '--repeat', '--mute', '--columns', '--ansi'])(
		'names %s, a flag run:board --frame takes',
		(flag) => {
			expect(skill).toContain(`\`${flag}`)
			expect(run_board_frame_preview.FRAME_USAGE).toContain(flag)
		},
	)

	it.each(['merged', 'stopped'])('names %s, a row state --notice takes', (state) => {
		expect(skill).toContain(`\`${state}\``)
		expect(run_board_sound_transition.ROW_SOUNDS).toHaveProperty(state)
	})

	it('leaves only the look, animation and sound to the post-merge check', () => {
		expect(skill).toContain('read the SGR codes')
		expect(skill).toContain('Only how a color looks, animation and sound are left to a person')
		expect(skill).toContain('`マージ後の確認: <where to look>`')
	})

	it('reports the frame lines read per state', () => {
		expect(skill).toContain(
			'- **Terminal UI**: state by state, the command run and the frame lines you read.',
		)
	})
})

describe.each(AI_DOCS)('%s — UI gate names the shipped skill', (document_path) => {
	it('points at the skill this package distributes', () => {
		expect(read_repo_file(document_path)).toContain(SKILL_REFERENCE)
	})
})
