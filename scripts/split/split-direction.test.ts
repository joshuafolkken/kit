import { git_gh_command } from '#scripts/gh/git-gh-command'
import { SPLIT_ROUTE_LABEL, TIER_A_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { file_reader } from '#scripts/lib/read-file'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { split_direction } from './split-direction'

const KEPT = '5953'
const SPLIT_FILING = { route: SPLIT_ROUTE_LABEL, found_during: KEPT }
const RELAY = 'scripts/run/entry/run-entry-cli.ts'
// A path no file sits at: it names no command, so only its module name can be hit.
const ABSENT = 'scripts/split/split-absent-relay.ts'
const MODULE_SPAN = '`run-entry-cli`'
const CHILD_BODY = `## 背景\n\n\`${RELAY}\` の中継を切り出す。`
const ABSENT_CHILD = `## 背景\n\n\`${ABSENT}\` の中継を切り出す。`

// #5953's expected result and criteria as filed: they name `run:cut`, never `run-entry-cli`.
const ISSUE_5953_BODY = [
	'## 背景',
	'',
	'`run:cut` は今 `pre-gate-cut.md` の節を何も印字しない（`scripts/run/cut/run-cut-cli.ts` に `print_once` の参照が無い）。',
	'',
	'## 期待結果',
	'',
	'- `run:cut <N>` が `pre-gate-cut.md` → "Taking the cut" を、`run:cut --resume <N>` が "Resuming" を `run_step_section.print_once` で印字する。自明な verdict（`not-a-lane` / `fresh`）では印字しない。',
	'- `fullrun.md` の lane-child seam にある resume の言い直しをポインタにする。',
	'',
	'## 受け入れ条件',
	'',
	'- [ ] `run:cut` と `run:cut --resume` が該当節を印字し、自明な verdict では印字しない（テストで固定）',
	'- [ ] `pnpm josh read:set lane-child` の合計バイト数が PR の前より下がり、PR 本文に前後の値を書く',
].join('\n')

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
	const raw = body === undefined ? undefined : JSON.stringify({ number: Number(KEPT), body })
	const read = vi.fn<typeof git_gh_command.issue_get_labels_and_body>().mockResolvedValue(raw)

	vi.spyOn(git_gh_command, 'issue_get_labels_and_body').mockImplementation(read)

	return read
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('split_direction.refusal_of — a split prerequisite', () => {
	it('admits an explicitly declared split prerequisite (ac-a6f82ac3)', async () => {
		const read = stub_kept(kept_body(MODULE_SPAN))
		const filing = { ...SPLIT_FILING, labels: [TIER_A_ROUTE_LABEL] }

		expect(await split_direction.refusal_of(filing, CHILD_BODY)).toBeUndefined()
		expect(read).not.toHaveBeenCalled()
	})
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

		expect(await split_direction.refusal_of(SPLIT_FILING, ABSENT_CHILD)).toBeUndefined()
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

describe('split_direction.refusal_of — the commands of a split-off file', () => {
	it('admits documentation cleanup whose command mentions are not implementations (ac-5ab59a34, ac-63269a29)', async () => {
		stub_kept(kept_body('`pnpm josh rule:list` が規則を一覧表示する'))
		const child = '`docs/maintainers/rule-delivery-rationale.md` の説明を整理する。'

		expect(await split_direction.refusal_of(SPLIT_FILING, child)).toBeUndefined()
	})

	it.each(['docs/guide.md', 'docs/guide.mdx', 'docs/GUIDE.MD'])(
		'ignores command mentions without reading Markdown content: %s',
		(path: string) => {
			const read = vi.spyOn(file_reader, 'read_if_readable').mockReturnValue('pnpm josh rule:list')

			expect(split_direction.references(kept_body('`rule:list`'), `\`${path}\``)).toEqual([])
			expect(read).not.toHaveBeenCalled()
		},
	)

	it('retains a dependency on an explicitly named document', () => {
		const path = 'docs/maintainers/rule-delivery-rationale.md'
		const body = kept_body(`\`${path}\` の説明を更新する`)

		expect(split_direction.references(body, `\`${path}\``)).toEqual([
			{ path, name: 'rule-delivery-rationale' },
		])
	})

	it('refuses when the kept criteria name only the command a split-off file registers', async () => {
		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(undefined)
		stub_kept(kept_body('`run:entry` が節を中継する'))
		const refusal = await split_direction.refusal_of(SPLIT_FILING, CHILD_BODY)

		expect(refusal).toContain(`\`run:entry\` (\`${RELAY}\`)`)
		expect(refusal).toContain(`pnpm josh run:split ${KEPT} --prerequisite <P>`)
	})

	it('refuses #5953, whose criteria name the run:cut the split-off relay passes on', async () => {
		stub_kept(ISSUE_5953_BODY)
		const refusal = await split_direction.refusal_of(SPLIT_FILING, CHILD_BODY)

		expect(refusal).toContain(`\`run:cut\` (\`${RELAY}\`)`)
	})
})

describe('split_direction.references — a command registry', () => {
	it('ignores the command names a command registry lists (ac-8a4dc7bb)', () => {
		const path = 'scripts/josh/josh-commands-issue.ts'
		const read = vi
			.spyOn(file_reader, 'read_if_readable')
			.mockReturnValue("'issue:fold-existing': { script: 'x' }")
		const body = kept_body('`issue:fold-existing --apply <M> --found-during <N>` が畳み込む')

		expect(split_direction.references(body, `\`${path}\``)).toEqual([])
		expect(read).not.toHaveBeenCalled()
	})
})

describe('split_direction.references', () => {
	it('reads no module from the words of a command line or a directory', () => {
		const body = kept_body('`pnpm josh gate` と `run:entry` と `scripts/split/` が緑')
		const child = `\`scripts/split/\` と \`${ABSENT}\``

		expect(split_direction.references(body, child)).toEqual([])
	})

	it('reads a command from the words of a command line', () => {
		vi.spyOn(file_reader, 'read_if_readable').mockReturnValue(undefined)
		const body = kept_body('`pnpm josh run:entry 5953 --to halfrun` が節を印字する')

		expect(split_direction.references(body, CHILD_BODY)).toEqual([
			{ path: RELAY, name: 'run:entry' },
		])
	})

	it('reads a path with a line suffix by its file stem', () => {
		const body = kept_body(`\`${RELAY}:12\` が resume を中継する`)

		expect(split_direction.references(body, CHILD_BODY)).toEqual([
			{ path: RELAY, name: 'run-entry-cli' },
		])
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

		expect(await split_direction.is_direction_clear(SPLIT_FILING, ABSENT_CHILD)).toBe(true)
		expect(error).not.toHaveBeenCalled()
	})
})
