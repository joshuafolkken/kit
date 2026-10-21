import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn<(argv: ReadonlyArray<string>) => Promise<string>>())

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: read_mock } }))

const { plan_consumers } = await import('./plan-consumers')

// joshuafolkken/kit#4273: every existing reference to an identifier, grouped by kind, then a draft of
// the plan's existing-consumers section. `git grep` is mocked with a fake tree's output.

const IDENTIFIER = 'lane:pause'
const GREP_OUTPUT = [
	'scripts/backlog/backlog-occupied.ts:13:// suspended (`lane:pause`)',
	"scripts/backlog/backlog-occupied.test.ts:40:\tit('counts lane:pause')",
	'.github/workflows/ci.yml:12:run: pnpm josh lane:pause',
	'.claude/skills/workflow-commands/backlogrun.md:8:Run `josh lane:pause --all`.',
	'prompts/collaboration-workflow/upstream-interrupt.md:3:see lane:pause',
	'docs/josh-commands-backlog.md:90:### `josh lane:pause`',
].join('\n')
const MANY_HITS = 25
const GIT_USAGE_EXIT = 129

function exit_error(code: number): Error {
	return Object.assign(new Error(`git exited ${String(code)}`), { exitCode: code })
}

beforeEach(() => {
	read_mock.mockReset()
})

describe('plan_consumers.kind_of', () => {
	it.each([
		{ path: 'scripts/run/run-board.ts', kind: 'code' },
		{ path: '.claude/hooks/guard.sh', kind: 'code' },
		{ path: 'scripts/run/run-board.test.ts', kind: 'test' },
		{ path: 'scripts/josh/__snapshots__/x.test.ts.snap', kind: 'test' },
		{ path: 'prompts/review.md', kind: 'prompt' },
		{ path: '.claude/skills/epic-commands/SKILL.md', kind: 'prompt' },
		{ path: 'docs/how-to/run-issues.md', kind: 'doc' },
		{ path: 'README.md', kind: 'doc' },
		{ path: '.github/workflows/ci.yml', kind: 'config' },
		{ path: '.claude/settings.json', kind: 'config' },
		{ path: 'scripts/run/run-tiers.json', kind: 'config' },
	])('classifies $path as $kind', ({ path, kind }) => {
		expect(plan_consumers.kind_of(path)).toBe(kind)
	})
})

describe('plan_consumers.report — references grouped by kind', () => {
	it('searches the tracked tree but .josh for the fixed string, every line kept', async () => {
		read_mock.mockResolvedValue(GREP_OUTPUT)

		await plan_consumers.report([IDENTIFIER])

		expect(read_mock).toHaveBeenCalledWith([
			'grep',
			'-n',
			'-I',
			'-F',
			'-e',
			IDENTIFIER,
			'--',
			':(exclude).josh',
		])
	})

	it('lists each hit under its kind, in code, config, prompt, doc, test order', async () => {
		read_mock.mockResolvedValue(GREP_OUTPUT)

		const { text, has_failed } = await plan_consumers.report([IDENTIFIER])
		const labels = ['  code', '  config and workflows', '  prompts and skills', '  docs', '  tests']
		const order = labels.map((label) => text.indexOf(`${label}\n`))

		expect(has_failed).toBe(false)
		expect(order).toStrictEqual(order.toSorted((left, right) => left - right))
		expect(text).toContain('    scripts/backlog/backlog-occupied.ts:13  // suspended')
		expect(text).toContain('    docs/josh-commands-backlog.md:90  ')
	})
})

describe('plan_consumers.report — one common name cannot bury the rest', () => {
	it('caps a kind and says how many it left out', async () => {
		const lines = Array.from(
			{ length: MANY_HITS },
			(_, index) => `scripts/a${String(index)}.ts:1:x`,
		)

		read_mock.mockResolvedValue(lines.join('\n'))

		const { text } = await plan_consumers.report([IDENTIFIER])

		expect(text).toContain('… +5 more')
		expect(text).not.toContain('scripts/a24.ts:1')
		expect(text).toContain('`scripts/a7.ts`, +17 more — ')
		expect(text).not.toContain('`scripts/a8.ts`')
	})
})

describe('plan_consumers.report — the draft section', () => {
	it('drafts one entry per identifier, tests left out', async () => {
		read_mock.mockResolvedValue(GREP_OUTPUT)

		const { text } = await plan_consumers.report([IDENTIFIER])
		const draft = text.slice(text.indexOf('draft:'))

		expect(draft).toContain('### 影響を受ける既存の利用者')
		expect(draft).toContain(
			'- `lane:pause`: `scripts/backlog/backlog-occupied.ts`, `.github/workflows/ci.yml`, `.claude/skills/workflow-commands/backlogrun.md`, `prompts/collaboration-workflow/upstream-interrupt.md`, `docs/josh-commands-backlog.md` — ',
		)
		expect(draft).not.toContain('backlog-occupied.test.ts')
	})

	it('reports an identifier no file references, in the listing and the draft', async () => {
		read_mock.mockRejectedValue(exit_error(1))

		const { text, has_failed } = await plan_consumers.report(['plan:consumers'])

		expect(has_failed).toBe(false)
		expect(text).toContain('plan:consumers — no reference in the tracked tree')
		expect(text).toContain('- `plan:consumers`: no existing reference')
	})

	it('reports a search that could not run as failed, never as no reference', async () => {
		read_mock.mockRejectedValue(exit_error(GIT_USAGE_EXIT))

		const { text, has_failed } = await plan_consumers.report([IDENTIFIER])

		expect(has_failed).toBe(true)
		expect(text).toContain(`${IDENTIFIER} — git grep failed; not searched`)
	})
})
