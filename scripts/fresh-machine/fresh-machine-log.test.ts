import { describe, expect, it } from 'vitest'
import { fresh_machine_log } from './fresh-machine-log'

const SCENARIO = 'kit-test-html-start'
const FIRST_NAME = 'kit-test-html-start-1'
const TOKEN = 'gho_exampleTokenValue'
const CLAUDE_TOKEN = 'sk-ant-oat01-exampleTokenValue'
const PLAIN_LINE = 'pnpm josh gate'

function next_name(logs: Array<string>, repositories: Array<string> = []): string {
	return fresh_machine_log.next_name(SCENARIO, { logs, repositories })
}

describe('fresh_machine_log.next_name', () => {
	it('numbers the first run 1', () => {
		expect(next_name([])).toBe(FIRST_NAME)
	})

	it('numbers a rerun past the highest earlier log, not past the count', () => {
		const logs = ['kit-test-html-start-1.log', 'kit-test-html-start-12.log']

		expect(next_name(logs)).toBe('kit-test-html-start-13')
	})

	it('numbers past a repository another checkout left, which has no log here', () => {
		const repositories = ['kit-test-html-start-4', 'kit', 'kit-test-html-init-9']

		const logs = [fresh_machine_log.file_name(FIRST_NAME)]

		expect(next_name(logs, repositories)).toBe('kit-test-html-start-5')
	})

	it('numbers past the logs when they are ahead of the repositories', () => {
		expect(next_name(['kit-test-html-start-6.log'], [FIRST_NAME])).toBe('kit-test-html-start-7')
	})

	it('ignores the logs of other scenarios and files that are not logs', () => {
		const logs = [
			'kit-test-html-init-7.log',
			'kit-test-html-start-3.txt',
			'kit-test-html-start-x.log',
		]

		expect(next_name(logs)).toBe(FIRST_NAME)
	})
})

describe('fresh_machine_log.file_name', () => {
	it('is the name next_name reads back', () => {
		const logs = [fresh_machine_log.file_name(FIRST_NAME)]

		expect(next_name(logs)).toBe('kit-test-html-start-2')
	})
})

describe('fresh_machine_log.redact', () => {
	it('replaces every occurrence of the token', () => {
		const line = `https://x-access-token:${TOKEN}@github.com/ ${TOKEN}`

		expect(fresh_machine_log.redact(line, [TOKEN])).toBe(
			'https://x-access-token:[REDACTED]@github.com/ [REDACTED]',
		)
	})

	it('replaces each of several secrets', () => {
		const line = `${TOKEN} ${CLAUDE_TOKEN}`

		expect(fresh_machine_log.redact(line, [TOKEN, CLAUDE_TOKEN])).toBe('[REDACTED] [REDACTED]')
	})

	it.each([[[]], [['']]])('leaves the line as it is when the secrets are %j', (secrets) => {
		expect(fresh_machine_log.redact(PLAIN_LINE, secrets)).toBe(PLAIN_LINE)
	})
})
