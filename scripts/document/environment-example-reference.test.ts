import { describe, expect, it } from 'vitest'
import { ENV_EXAMPLE, read_document } from './ai-document-fixture'
import { environment_example_fixture } from './environment-example-fixture'

// `.env.example` must list exactly the keys a `.env` line can set, each with the docs table's default
// and only values that table row names, and ship every key blank (joshuafolkken/kit#7224).
const REFERENCE = 'docs/environment-variables.md'
const PROGRESS_INTERVAL_KEY = 'JOSH_PROGRESS_INTERVAL_MINUTES'
const MODE_KEY = 'JOSH_MODE'
const SHELL_KEY = 'JOSH_SHELL'
const { environment_example_drift, example_entries } = environment_example_fixture

const DOCUMENT = [
	'## Variables you set',
	'Every other command reads only the real environment:',
	'',
	`- \`${SHELL_KEY}\`.`,
	'',
	'A paragraph after the list: `JOSH_MODE`.',
	'| Variable | Required | Default | Used when |',
	`| \`${MODE_KEY}\` | No | \`auto\` | \`auto\` or \`rest\`. |`,
	'| `JOSH_SHELL` | No | off | Shell only. |',
	'| `JOSH_RULE_GUARD` | No | on | A guard. |',
	'| `JOSH_OLD` | No | — | Legacy alias. |',
	'| `JOSH_CORE` | No | unset | Set by josh, never by hand. |',
	'## Variables kit sets itself',
	'| `JOSH_CHILD` | a dispatch | This session is a child. |',
].join('\n')

function example_block(head: string, key = MODE_KEY, value = ''): string {
	return `${head}\n# Which mode.\n${key}=${value}\n`
}

describe('.env.example against the environment variable reference', () => {
	it('agrees with every offered row of docs/environment-variables.md', () => {
		expect(
			environment_example_drift(read_document(REFERENCE), read_document(ENV_EXAMPLE)),
		).toStrictEqual([])
	})

	it('repeats the shell-only limit of the progress interval', () => {
		const block = read_document(ENV_EXAMPLE)
			.split('\n\n')
			.find((text) => text.endsWith(`${PROGRESS_INTERVAL_KEY}=`))

		expect(block).toContain('josh run:progress')
	})
})

describe('environment_example_drift', () => {
	it('offers only the rows a .env line can set', () => {
		const example = example_block('# Default: auto · Values: auto, rest')

		expect(environment_example_drift(DOCUMENT, example)).toStrictEqual([])
	})

	it('names a missing key and an extra one', () => {
		const extra = example_block('# Default: off', SHELL_KEY)

		expect(environment_example_drift(DOCUMENT, extra)).toStrictEqual([
			`extra: ${SHELL_KEY}`,
			`missing: ${MODE_KEY}`,
		])
	})
})

describe('environment_example_drift on one entry', () => {
	it('names a default the docs row does not give', () => {
		expect(environment_example_drift(DOCUMENT, example_block('# Default: rest'))).toStrictEqual([
			`${MODE_KEY}: default rest is not the docs auto`,
		])
	})

	it('names a default that only begins with the docs one', () => {
		expect(environment_example_drift(DOCUMENT, example_block('# Default: autos'))).toStrictEqual([
			`${MODE_KEY}: default autos is not the docs auto`,
		])
	})

	it('names a value the docs row has only in its prose', () => {
		const head = '# Default: auto · Values: or'

		expect(environment_example_drift(DOCUMENT, example_block(head))).toStrictEqual([
			`${MODE_KEY}: value or is not in the docs row`,
		])
	})

	it('names a value the docs row does not name', () => {
		const head = '# Default: auto · Values: auto, graphql'

		expect(environment_example_drift(DOCUMENT, example_block(head))).toStrictEqual([
			`${MODE_KEY}: value graphql is not in the docs row`,
		])
	})

	it('names a key that ships a value or has no default line', () => {
		expect(
			environment_example_drift(DOCUMENT, example_block('# Which mode.', MODE_KEY, 'rest')),
		).toStrictEqual([`${MODE_KEY}: ships a value`, `${MODE_KEY}: no # Default: line`])
	})

	it('reads a key only from a block that ends in its assignment', () => {
		expect(example_entries('# --- Heading ---\n\n# Default: on\nJOSH_A=\n')).toStrictEqual([
			{ key: 'JOSH_A', value: '', head: '# Default: on' },
		])
	})
})
