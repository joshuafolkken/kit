import { existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it } from 'vitest'
import { gh_tally_handoff, type HandedTally } from './gh-tally-handoff'

// joshuafolkken/kit#6965: a spawned josh command hands its gh request tally back to the dispatcher.

const HANDED: HandedTally = {
	calls: 2,
	not_modified: 1,
	endpoints: { graphql: { calls: 2, not_modified: 1 } },
}

const make_directory = temporary_directory()
const scratch = { directory: '' }

function target(): string {
	return path.join(scratch.directory, 'tally.jsonl')
}

// The exit listen seam, collecting each listener into `listeners` instead of the process.
function collecting(listeners: Array<() => void>): (listener: () => void) => void {
	return function listen(listener: () => void): void {
		listeners.push(listener)
	}
}

// Arms against `environment` and answers the exit listener it registered, if any.
function armed_exit(environment: NodeJS.ProcessEnv): (() => void) | undefined {
	const listeners: Array<() => void> = []

	gh_tally_handoff.arm(() => HANDED, environment, collecting(listeners))

	return listeners[0]
}

beforeEach(() => {
	gh_tally_handoff.reset()
	scratch.directory = make_directory('gh-tally-handoff-')
})

describe('gh_tally_handoff.arm — the child side', () => {
	it('appends the tally to the named file as the process exits, and taken reads it back', () => {
		const exit = armed_exit({ [gh_tally_handoff.HANDOFF_ENV]: target() })

		exit?.()

		expect(gh_tally_handoff.taken(target())).toStrictEqual([HANDED])
	})

	it('registers one exit listener however many calls arm it', () => {
		const listeners: Array<() => void> = []
		const environment = { [gh_tally_handoff.HANDOFF_ENV]: target() }

		gh_tally_handoff.arm(() => HANDED, environment, collecting(listeners))
		gh_tally_handoff.arm(() => HANDED, environment, collecting(listeners))

		expect(listeners).toHaveLength(1)
	})

	it.each([
		['no handoff file is named', {}],
		['the process is a test run', { VITEST: 'true', JOSH_GH_TALLY_FILE: 'x' }],
	])('registers nothing when %s', (_case, environment) => {
		expect(armed_exit(environment)).toBeUndefined()
	})
})

describe('gh_tally_handoff.taken — the dispatcher side', () => {
	it('answers every parsed line, drops an unparsed one, and removes the file', () => {
		writeFileSync(target(), `${JSON.stringify(HANDED)}\nnot json\n${JSON.stringify(HANDED)}\n`)

		expect(gh_tally_handoff.taken(target())).toStrictEqual([HANDED, HANDED])
		expect(existsSync(target())).toBe(false)
	})

	it('answers none when the child wrote no file', () => {
		expect(gh_tally_handoff.taken(target())).toStrictEqual([])
	})

	it('names a fresh file under the temporary directory each time', () => {
		const first = gh_tally_handoff.target_path()

		expect(first.startsWith(os.tmpdir())).toBe(true)
		expect(gh_tally_handoff.target_path()).not.toBe(first)
	})
})
