import type { PortEnvironment } from '#ports'
import { describe, expect, it } from 'vitest'
import { port_command } from './port-command'

const DEFAULT_DEV_PORT = 5173
const DEFAULT_PREVIEW_PORT = 4173
const SEED = 1
const SUCCESS_EXIT_CODE = 0
const USAGE_EXIT_CODE = 1

function seeded(seed: number): PortEnvironment {
	return { PORT_SEED: String(seed) }
}

describe('josh port', () => {
	it('offers exactly the two ports a project owns', () => {
		expect(port_command.PORT_NAMES).toStrictEqual(['dev', 'preview'])
	})

	// The output is substituted straight into a command line, so stray characters would be passed
	// on as part of the port argument.
	it('prints the dev port as a bare number', () => {
		expect(port_command.run(['dev'], {})).toStrictEqual({
			text: String(DEFAULT_DEV_PORT),
			exit_code: SUCCESS_EXIT_CODE,
		})
	})

	it('prints the preview port as a bare number', () => {
		expect(port_command.run(['preview'], {})).toStrictEqual({
			text: String(DEFAULT_PREVIEW_PORT),
			exit_code: SUCCESS_EXIT_CODE,
		})
	})

	it('follows the seed, so a package.json script and Playwright agree on the port', () => {
		const environment = seeded(SEED)

		expect(port_command.run(['dev'], environment).text).toBe(String(DEFAULT_DEV_PORT + SEED))
		expect(port_command.run(['preview'], environment).text).toBe(
			String(DEFAULT_PREVIEW_PORT + SEED),
		)
	})
})

describe('josh port argument handling', () => {
	it.each([[[]], [['bogus']], [['']], [['dev', 'preview']]])(
		'exits non-zero with usage for %j',
		(argv: ReadonlyArray<string>) => {
			expect(port_command.run(argv, {}).exit_code).toBe(USAGE_EXIT_CODE)
		},
	)

	it('names both ports in the usage text', () => {
		expect(port_command.USAGE).toContain('dev')
		expect(port_command.USAGE).toContain('preview')
	})

	// `$(josh port preview)` substitutes stdout into a command line, so a resolver failure has to
	// arrive as a readable message and a non-zero exit rather than an uncaught stack trace.
	it('reports an invalid seed as a message instead of throwing', () => {
		const result = port_command.run(['preview'], { PORT_SEED: 'abc' })

		expect(result.exit_code).not.toBe(SUCCESS_EXIT_CODE)
		expect(result.text).toContain('PORT_SEED')
	})

	it('rejects an unknown port name', () => {
		expect(port_command.is_port_name('dev')).toBe(true)
		expect(port_command.is_port_name('bogus')).toBe(false)
		expect(port_command.is_port_name(undefined)).toBe(false)
	})
})
