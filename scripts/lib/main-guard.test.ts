import { describe, expect, it } from 'vitest'
import { main_guard } from './main-guard'

const MAIN = 'async function main(): Promise<void> {}'
const AWAIT_MAIN = 'await main()'
const GUARDED = `${MAIN}\nif (process.argv[1] === fileURLToPath(import.meta.url)) ${AWAIT_MAIN}`

describe('main_guard.import_blocker', () => {
	it('names a main guard', () => {
		expect(main_guard.import_blocker(GUARDED)).toBe(main_guard.GUARD_REASON)
	})

	it.each([
		'main()',
		AWAIT_MAIN,
		'void main()',
		`try {\n\t${AWAIT_MAIN}\n} catch {\n\tprocess.exit(1)\n}`,
	])('names a top-level `%s`', (call) => {
		const source = `${MAIN}\n${call}\n`

		expect(main_guard.import_blocker(source)).toBe(main_guard.UNCONDITIONAL_REASON)
	})

	it('passes a module that only names either in a comment or a nested call', () => {
		const source = [
			'// a guard reads `if (process.argv[1] === …)` and calls main()',
			'function run(): void {',
			'\tmain()',
			'}',
		].join('\n')

		expect(main_guard.import_blocker(source)).toBeUndefined()
	})
})

describe('main_guard.has_main_guard', () => {
	it('answers the guard alone, not a top-level main()', () => {
		expect(main_guard.has_main_guard(GUARDED)).toBe(true)
		expect(main_guard.has_main_guard(`${AWAIT_MAIN}\n`)).toBe(false)
	})
})
