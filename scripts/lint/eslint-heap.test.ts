import { execFileSync } from 'node:child_process'
import { buffered_process } from '#scripts/lib/buffered-process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { eslint_heap, ESLINT_HEAP_MIB } from './eslint-heap'

// joshuafolkken/kit#6331: whole-tree ESLint ran out of V8's default heap in CI and locally.

const HEAP = `--max-old-space-size=${String(ESLINT_HEAP_MIB)}`
const MIB = 1024 * 1024
const SOURCE_MAPS = '--enable-source-maps'
const PERSON_LIMIT = '--max-old-space-size=2048'
const READ_HEAP_LIMIT =
	"process.stdout.write(String(require('node:v8').getHeapStatistics().heap_size_limit))"

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('eslint_heap.with_heap', () => {
	it('sets the heap when nothing is set', () => {
		expect(eslint_heap.with_heap(undefined)).toBe(HEAP)
		expect(eslint_heap.with_heap('  ')).toBe(HEAP)
	})

	it('keeps the other options beside it', () => {
		expect(eslint_heap.with_heap(SOURCE_MAPS)).toBe(`${SOURCE_MAPS} ${HEAP}`)
	})

	it.each([PERSON_LIMIT, '--max_old_space_size=2048'])(
		'respects a limit the person set: %s',
		(node_options) => {
			expect(eslint_heap.with_heap(node_options)).toBe(node_options)
		},
	)
})

describe('eslint_heap.environment', () => {
	it('adds the heap to the buffered child environment and keeps the rest', () => {
		vi.stubEnv('NODE_OPTIONS', SOURCE_MAPS)
		vi.stubEnv('NO_COLOR', undefined)

		const environment = eslint_heap.environment()

		expect(environment['NODE_OPTIONS']).toBe(`${SOURCE_MAPS} ${HEAP}`)
		expect(environment['FORCE_COLOR']).toBe('1')
	})

	it('raises a real Node child heap to at least the ESLint size', () => {
		vi.stubEnv('NODE_OPTIONS', '')

		const limit = Number(
			execFileSync(process.execPath, ['-e', READ_HEAP_LIMIT], { env: eslint_heap.environment() }),
		)

		expect(limit).toBeGreaterThanOrEqual(ESLINT_HEAP_MIB * MIB)
	})
})

// joshuafolkken/kit#7256: the cold eslint runs without pnpm's wrapper process, under the heap.
describe('eslint_heap.run_cold', () => {
	it('launches the eslint list directly with the heap and the memory hook', async () => {
		const run_direct = vi
			.spyOn(buffered_process, 'run_buffered_direct')
			.mockResolvedValue({ output: '', exit_code: 0, elapsed_ms: 0 })
		const eslint_list = ['exec', 'eslint', '.']

		await eslint_heap.run_cold(eslint_list)

		expect(run_direct).toHaveBeenCalledWith(eslint_list, {
			environment: expect.objectContaining({
				NODE_OPTIONS: expect.stringMatching(/--max-old-space-size=\d+ --import=file:/u),
			}),
		})
	})
})
