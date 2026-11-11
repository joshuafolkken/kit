import { describe, expect, it } from 'vitest'
import { keychain_read } from './keychain-read'

// joshuafolkken/kit#7198: the program-level check behind the egress row; the shell spellings (pipes,
// `$(…)`, `bash -c`, launchers) are fixed in `egress-guard.test.ts`.

const SECURITY = 'security'
const GENERIC = 'find-generic-password'
const DUMP = 'dump-keychain'
const LIST = 'list-keychains'

function reads(name: string, args: ReadonlyArray<string>): boolean {
	return keychain_read.is_keychain_read('', { name, args: [...args] })
}

describe('keychain_read.is_keychain_read — refuses a secret subcommand', () => {
	it.each([
		[[GENERIC, '-w']],
		[['find-internet-password', '-w']],
		[[DUMP]],
		[['export', '-o', 'out.p12']],
		[['export-identities']],
		[['-v', GENERIC]],
		[['-p', 'prompt', DUMP]],
		[['-i']],
		[['-qi']],
		[['-qp', 'prompt', DUMP]],
		[['-pp', DUMP]],
		[['-qpp', GENERIC]],
	])('refuses security %j', (args) => {
		expect(reads(SECURITY, args)).toBe(true)
	})
})

describe('keychain_read.is_keychain_read — leaves other calls alone', () => {
	it.each([
		[SECURITY, [LIST]],
		[SECURITY, ['find-certificate', '-a']],
		[SECURITY, ['-p', DUMP, LIST]],
		[SECURITY, [LIST, '-i']],
		[SECURITY, ['-p', '-i', LIST]],
		[SECURITY, ['-pi', LIST]],
		[SECURITY, []],
		['grep', [GENERIC]],
	])('leaves %s %j alone', (name, args) => {
		expect(reads(name, args)).toBe(false)
	})
})
