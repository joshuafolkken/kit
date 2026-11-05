import { execFileSync } from 'node:child_process'
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
