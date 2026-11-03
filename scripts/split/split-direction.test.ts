import { git_gh_command } from '#scripts/gh/git-gh-command'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { split_direction } from './split-direction'

const KEPT = '5953'
const SPLIT_FILING = { route: SPLIT_ROUTE_LABEL, found_during: KEPT }
const RELAY = 'scripts/run/entry/run-entry-cli.ts'
const MODULE_SPAN = '`run-entry-cli`'
const CHILD_BODY = `## 背景\n\n\`${RELAY}\` の中継を切り出す。`

function kept_body(criteria: string): string {
	return [
		'## 背景',
		'',
		`\`${RELAY}\` は背景にだけ書かれている。`,
		'',
		'## 期待結果',
		'',
		'- `run:cut --resume <N>` が節を印字する。',
		'',
		'## 受け入れ条件',
		'',
		`- [ ] ${criteria}`,
	].join('\n')
}

function stub_kept(body: string | undefined): ReturnType<typeof vi.fn> {
	const read = vi.fn<typeof git_gh_command.issue_get_body>().mockResolvedValue(body)

	vi.spyOn(git_gh_command, 'issue_get_body').mockImplementation(read)

	return read
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('split_direction.refusal_of', () => {
	it('refuses when the kept criteria name the module of a split-off file', async () => {
		stub_kept(kept_body('`run-entry-cli.ts` が resume を中継する'))
		const refusal = await split_direction.refusal_of(SPLIT_FILING, CHILD_BODY)

		expect(refusal).toContain(`\`run-entry-cli\` (\`${RELAY}\`)`)
		expect(refusal).toContain(`pnpm josh run:split ${KEPT} --prerequisite <P>`)
		expect(refusal).toContain('nothing was filed')
	})

	it('reads an identifier written with underscores as the module', async () => {
		stub_kept(kept_body('`run_entry_cli.main` が resume を中継する'))

		expect(await split_direction.refusal_of(SPLIT_FILING, CHILD_BODY)).toBeDefined()
	})

	it('lets the split through when only the background names the file', async () => {
		stub_kept(kept_body('`run:cut` が節を印字する'))

		expect(await split_direction.refusal_of(SPLIT_FILING, CHILD_BODY)).toBeUndefined()
	})

	it('lets the split through when the kept body cannot be read', async () => {
		stub_kept(undefined)

		expect(await split_direction.refusal_of(SPLIT_FILING, CHILD_BODY)).toBeUndefined()
	})

	it('reads nothing for another route, no finder or a cross-repository finder', async () => {
		const read = stub_kept(kept_body(MODULE_SPAN))
		const filings = [
			{ route: 'route:tier-a', found_during: KEPT },
			{ route: SPLIT_ROUTE_LABEL, found_during: undefined },
			{ route: SPLIT_ROUTE_LABEL, found_during: `joshuafolkken/other#${KEPT}` },
		]
		const refusals = await Promise.all(
			filings.map(async (filing) => await split_direction.refusal_of(filing, CHILD_BODY)),
		)

		expect(refusals).toEqual([undefined, undefined, undefined])
		expect(read).not.toHaveBeenCalled()
	})
})

describe('split_direction.references', () => {
	it('ignores a declared directory', () => {
		const body = kept_body('`entry` の配下')

		expect(split_direction.references(body, '`scripts/run/entry/`')).toEqual([])
	})
})

describe('split_direction.is_direction_clear', () => {
	it('prints the refusal and answers false', async () => {
		stub_kept(kept_body(MODULE_SPAN))
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await split_direction.is_direction_clear(SPLIT_FILING, CHILD_BODY)).toBe(false)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('run:split 5953 --prerequisite'))
	})

	it('answers true without printing when nothing is named', async () => {
		stub_kept(kept_body('`run:cut`'))
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await split_direction.is_direction_clear(SPLIT_FILING, CHILD_BODY)).toBe(true)
		expect(error).not.toHaveBeenCalled()
	})
})
