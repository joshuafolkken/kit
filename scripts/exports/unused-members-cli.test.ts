import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { SKIP_MARKER } from '#scripts/test/skip-marker'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unused_members_cli } from './unused-members-cli'
import { unused_members_fixture } from './unused-members-fixture'

const { create_project, with_reader, READ_KEPT } = unused_members_fixture
const PASS_EXIT_CODE = 0
const FAIL_EXIT_CODE = 1
const READ_ALL = 'export const value = library.kept() + library.dropped()'

function capture(): { info: Array<string>; error: Array<string> } {
	const info: Array<string> = []
	const error: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation((message: string) => {
		info.push(message)
	})
	vi.spyOn(console, 'error').mockImplementation((message: string) => {
		error.push(message)
	})

	return { info, error }
}

afterEach(() => vi.restoreAllMocks())

describe('unused_members_cli.run_unused_members', () => {
	it('passes and says so when every member is read', async () => {
		const output = capture()
		const exit_code = await unused_members_cli.run_unused_members(
			create_project(with_reader(READ_ALL)),
		)

		expect(exit_code).toBe(PASS_EXIT_CODE)
		expect(output.info.join('\n')).toContain('no unused namespace member')
	})

	it('fails and names each unused member with its location', async () => {
		const output = capture()
		const exit_code = await unused_members_cli.run_unused_members(
			create_project(with_reader(READ_KEPT)),
		)
		const text = output.error.join('\n')

		expect(exit_code).toBe(FAIL_EXIT_CODE)
		expect(text).toContain('1 namespace member(s) nothing reads')
		expect(text).toContain('library.ts:3  library.dropped')
	})

	it('skips a consumer project without scanning it', async () => {
		const output = capture()
		const root = create_project(with_reader(READ_KEPT))
		const manifest = { name: 'consumer', devDependencies: { [KIT_PACKAGE_NAME]: '1.0.0' } }

		writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))

		expect(await unused_members_cli.run_unused_members(root)).toBe(PASS_EXIT_CODE)
		expect(output.info).toStrictEqual([unused_members_cli.CONSUMER_NOTICE])
		expect(output.error).toStrictEqual([])
	})

	it('says a consumer is out of scope without the skip marker that withholds the green record', () => {
		expect(unused_members_cli.CONSUMER_NOTICE).toContain('nothing to check in a consumer project')
		expect(unused_members_cli.CONSUMER_NOTICE).not.toContain(SKIP_MARKER)
	})
})
