import { describe, expect, it } from 'vitest'
import { command_memory } from './command-memory'
import { core_weights } from './core-weights'

// joshuafolkken/kit#4582: `reserved-run` reserved a wrapped command's cores and no memory, so a
// four-worker typed eslint holding 12 GB was admitted beside four other lanes. Pinned here is the
// reading the wrapper reserves from and the lane rule refuses on: the tool, its worker count, a shell's
// quoted script, and the 0 MB a command the table does not know keeps.

const { MEMORY_MB } = core_weights
const CORES = 11
const FOUR_WORKERS = 4
const THREE_WORKERS = 3
// ESLint 10's `auto` on 11 cores: half, rounded down.
const AUTO_WORKERS = 5
// vitest's run-mode default on 11 cores: all but one.
const VITEST_DEFAULT_WORKERS = 10
const ESLINT_FOUR = 'pnpm exec eslint . --concurrency 4'
const ESLINT_FOUR_EQUALS = 'pnpm exec eslint . --concurrency=4'
const ESLINT_AUTO = 'pnpm exec eslint . --concurrency auto'
const ESLINT_OFF = 'pnpm exec eslint . --concurrency off'
const ESLINT_SINGLE = 'pnpm exec eslint .'
const VITEST_THREE = 'vitest run --maxWorkers 3'
const RESERVED = 'pnpm josh reserved-run 4 --'

describe('command_memory.estimated_memory_mb', () => {
	it.each([
		[ESLINT_FOUR, MEMORY_MB.lint * FOUR_WORKERS],
		[ESLINT_FOUR_EQUALS, MEMORY_MB.lint * FOUR_WORKERS],
		[ESLINT_AUTO, MEMORY_MB.lint * AUTO_WORKERS],
		[ESLINT_OFF, MEMORY_MB.lint],
		[ESLINT_SINGLE, MEMORY_MB.lint],
		[`sh -c '${ESLINT_FOUR}'`, MEMORY_MB.lint * FOUR_WORKERS],
		['bash -c "cd x && npx eslint . --concurrency 4"', MEMORY_MB.lint * FOUR_WORKERS],
		[VITEST_THREE, MEMORY_MB.unit_worker * THREE_WORKERS],
		// No `--maxWorkers`: vitest's own default, the machine less one.
		['pnpm vitest run', MEMORY_MB.unit_worker * VITEST_DEFAULT_WORKERS],
		['pnpm tsc --noEmit', MEMORY_MB.type_check],
		['pnpm install', MEMORY_MB.install],
		// A heredoc a shell reads is its script, the `sh -c` escape spelled another way.
		[`bash <<'EOF'\ncd x\n${ESLINT_FOUR}\nEOF`, MEMORY_MB.lint * FOUR_WORKERS],
		[`sh -s <<EOF\n${ESLINT_FOUR}\nEOF\necho done`, MEMORY_MB.lint * FOUR_WORKERS],
	])('reads `%s` as %d MB', (line: string, expected: number) => {
		expect(command_memory.estimated_memory_mb(line, CORES)).toBe(expected)
	})

	// One line's commands run one after another, so only the largest is resident at a time.
	it('takes the largest tool on the line, not the sum', () => {
		expect(
			command_memory.estimated_memory_mb(`pnpm exec cspell . && ${ESLINT_SINGLE}`, CORES),
		).toBe(MEMORY_MB.lint)
	})

	// A `josh` command reserves its own place; counting it here would count it twice.
	// A heredoc body is text, and a shell word that is not the program runs no script.
	it.each([
		['pnpm josh audit'],
		['node --version'],
		['git commit -m "run eslint"'],
		[`cat <<'EOF'\n${ESLINT_FOUR}\nEOF`],
		[`echo sh -c '${ESLINT_FOUR}'`],
	])('leaves `%s` at no estimate', (line: string) => {
		expect(command_memory.estimated_memory_mb(line, CORES)).toBeUndefined()
	})
})

describe('command_memory.tool_calls_of', () => {
	it('marks the command a `reserved-run` wraps as reserved', () => {
		const calls = command_memory.tool_calls_of(`${RESERVED} sh -c '${ESLINT_SINGLE}'`)

		expect(calls.map((call) => [call.name, call.is_reserved])).toEqual([['eslint', true]])
	})

	it('leaves a direct call unreserved', () => {
		expect(command_memory.tool_calls_of('npx vitest run')).toEqual([
			{ name: 'vitest', args: ['run'], is_reserved: false },
		])
	})
})

describe('command_memory.runs_multi_worker_eslint', () => {
	it.each([
		[`${RESERVED} ${ESLINT_FOUR}`],
		[`${RESERVED} sh -c '${ESLINT_FOUR}'`],
		[ESLINT_AUTO],
		[ESLINT_FOUR_EQUALS],
	])('is true for `%s`', (line: string) => {
		expect(command_memory.runs_multi_worker_eslint(line, CORES)).toBe(true)
	})

	it.each([[ESLINT_OFF], ['pnpm exec eslint . --concurrency 1'], [ESLINT_SINGLE], [VITEST_THREE]])(
		'is false for `%s`',
		(line: string) => {
			expect(command_memory.runs_multi_worker_eslint(line, CORES)).toBe(false)
		},
	)
})
