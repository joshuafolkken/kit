import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { issue_file } from '#scripts/issue/issue-file'
import { issue_wip } from '#scripts/issue/issue-wip'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3853: `auto-ok` is judged by `issue:file` from the criteria whoever asked for
// the Issue, so no `new` step declares `--requested` any more. The words a person may type after
// `new` are still defined in one table rather than left to each run's reading.
//
// joshuafolkken/kit#7269: a typed `new` is exempt from the WIP cap (`wip-cap.md`), so the documented
// filing carries `--over-cap` and files past the cap at once instead of being held for a reissue.
// `prrun new` runs `fullrun new`'s steps, so its filing is the fullrun one.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands'
const OVER_CAP_FLAG = '--over-cap'
const NEW_FILING_ARGV = ['<title>', '--body-file', '.josh/tmp/body.md', OVER_CAP_FLAG]
const NEW_FILING = `pnpm josh issue:file "<title>" ${NEW_FILING_ARGV.slice(1).join(' ')}\``
const OVER = issue_wip.DEFAULT_WIP_CAP + 1
const NEW_STEP_DOCUMENTS = [
	`${WORKFLOW_SKILL}/kickoff.md`,
	`${WORKFLOW_SKILL}/halfrun.md`,
	`${WORKFLOW_SKILL}/fullrun-steps.md`,
]

describe.each(NEW_STEP_DOCUMENTS)('%s — the `new` filing a person asked for', (document) => {
	it('files without the retired --requested', () => {
		const text = read_unwrapped(document)

		expect(text).toContain(NEW_FILING)
		expect(text).not.toContain('--requested')
	})

	it('points at the table of words typed after `new`', () => {
		expect(read_unwrapped(document)).toContain('"Words typed after `new`"')
	})
})

function verdict_past_cap(argv: ReadonlyArray<string>): string | undefined {
	const args = issue_file.parse(argv)

	if (args === undefined) return undefined

	return issue_wip.verdict_of(
		OVER,
		{ route: args.route, is_over_cap: args.is_over_cap },
		issue_wip.DEFAULT_WIP_CAP,
	)
}

describe('the `new` filing past the WIP cap', () => {
	it('is exempt as documented, so it files without a held reissue', () => {
		expect(verdict_past_cap(NEW_FILING_ARGV)).toBe('exempt')
	})

	it('is held when the filing declares no exemption', () => {
		const bare = NEW_FILING_ARGV.filter((flag) => flag !== OVER_CAP_FLAG)

		expect(verdict_past_cap(bare)).toBe(issue_wip.HELD)
	})

	it('is named in wip-cap.md as filing with --over-cap from the start', () => {
		expect(read_unwrapped('prompts/collaboration-workflow/wip-cap.md')).toContain(
			'利用者が `new` と打った入口は、手順書の起票コマンドが最初から `--over-cap` を付ける',
		)
	})

	it('is named in the --over-cap description of josh issue:file', () => {
		expect(read_unwrapped('docs/josh-commands-backlog.md')).toContain(
			'- `--over-cap` — the run is blocked by this filing, or a user typed `new`',
		)
	})
})

describe('kickoff.md — the multi-issue split of a `new` entry', () => {
	it('files each split child without --requested', () => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/kickoff.md`)).toContain(
			'.josh/tmp/body.md --route split` plus the labels',
		)
	})
})

describe('kickoff.md — the words typed after `new`', () => {
	it.each([
		['auto ok', /\| `auto ok` \| nothing — `issue:file` judges it\s*\|/u],
		['critical', /\| `critical` \s*\| `--label priority:critical`\s*\|/u],
		['high', /\| `high` \s*\| `--label priority:high`\s*\|/u],
	])('maps `%s` in the table', (_word, row) => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/kickoff.md`)).toMatch(row)
	})
})
