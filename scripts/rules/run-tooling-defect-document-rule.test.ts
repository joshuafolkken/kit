import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { section_reference_resolution } from '#scripts/document/section-reference-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3297: a defect in kit's own run tooling stopped a `backlogrun` as if it were another
// package's, the AI waited for a person to retype a resumable run, and #3255 was parked with
// `needs-decision` although nothing needed a person. Each rule is written once and every document that
// used to decide it on its own now points at that single source; both halves are pinned here.

const UPSTREAM_INTERRUPT = 'prompts/collaboration-workflow/upstream-interrupt.md'
const PARK = '.claude/skills/workflow-commands/backlogrun-park.md'
const RUN_TOOLING_HEADING = '実行中のリポジトリ自身のラン機構の不具合'
const NEEDS_DECISION_HEADING = "Only a person's judgement carries `needs-decision`"

const STEPS = '.claude/skills/workflow-commands/backlogrun-steps.md'
const CARRIES = 'carries %s'
const POINTS_AT = '%s points at the single source'

const RUN_TOOLING_POINTERS: ReadonlyArray<string> = [
	'CLAUDE.md',
	STEPS,
	'docs/josh-commands-run.md',
	PARK,
]

const NEEDS_DECISION_POINTERS: ReadonlyArray<string> = [
	STEPS,
	'.claude/skills/workflow-commands/backlogrun-progress.md',
	'.claude/skills/workflow-commands/backlogrun-recovery.md',
	UPSTREAM_INTERRUPT,
]

describe(`${UPSTREAM_INTERRUPT} — the run-tooling defect is an interrupt`, () => {
	const content = read_unwrapped(UPSTREAM_INTERRUPT)

	it.each([
		`### ${RUN_TOOLING_HEADING}`,
		'--route interrupt --label priority:high',
		'pnpm josh run:wake --start',
		'pnpm josh run:carry --resume',
		'pnpm josh run:wake --list',
		'`expired`',
		'`mismatch`',
	])(CARRIES, (marker) => {
		expect(content).toContain(marker)
	})

	it.each(RUN_TOOLING_POINTERS)(POINTS_AT, (document_path) => {
		expect(read_unwrapped(document_path)).toContain(`→ "${RUN_TOOLING_HEADING}"`)
	})
})

describe(`${PARK} — only a person's judgement carries needs-decision`, () => {
	const content = read_unwrapped(PARK)

	it.each([`## ${NEEDS_DECISION_HEADING}`, 'When in doubt, it is Tier A', '`auto-ok`'])(
		CARRIES,
		(marker) => {
			expect(content).toContain(marker)
		},
	)

	it.each(NEEDS_DECISION_POINTERS)(POINTS_AT, (document_path) => {
		expect(read_unwrapped(document_path)).toContain(`→ "${NEEDS_DECISION_HEADING}"`)
	})
})

describe('the pointers resolve', () => {
	it.each([...new Set([...RUN_TOOLING_POINTERS, ...NEEDS_DECISION_POINTERS])])(
		'%s has no broken section reference',
		(document_path) => {
			expect(
				section_reference_resolution.broken_section_references(read_unwrapped(document_path)),
			).toEqual([])
		},
	)
})
