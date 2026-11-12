import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_consolidate_cli } from './issue-consolidate-cli'

const { consolidate } = vi.hoisted(() => ({ consolidate: vi.fn<() => Promise<number>>() }))

vi.mock('./issue-consolidate', () => ({ issue_consolidate: { consolidate } }))

const create_directory = temporary_directory()
const TARGET = '6559'
const DUPLICATE = '6567'
const BODY = 'Merged scope.\n'

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	consolidate.mockResolvedValue(0)
})

afterEach(() => {
	process.exitCode = undefined
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('issue_consolidate_cli.main', () => {
	it('sets the exit code consolidate answers', async () => {
		consolidate.mockResolvedValue(1)

		await issue_consolidate_cli.main([TARGET, DUPLICATE])

		expect(process.exitCode).toBe(1)
	})
})

describe('issue_consolidate_cli.run', () => {
	it('passes the target, duplicates, title, body and --demote through', async () => {
		const body_file = path.join(create_directory('consolidate-'), 'body.md')

		writeFileSync(body_file, BODY)

		const argv = [TARGET, DUPLICATE, '6568', '--title', ' Merged ', '--body-file', body_file]

		expect(await issue_consolidate_cli.run([...argv, '--demote'])).toBe(0)
		expect(consolidate).toHaveBeenCalledExactlyOnceWith({
			target: 6559,
			duplicates: [6567, 6568],
			title: 'Merged',
			body: BODY,
			is_demote: true,
		})
	})

	it('returns the exit code consolidate answers', async () => {
		consolidate.mockResolvedValue(1)

		expect(await issue_consolidate_cli.run([TARGET, DUPLICATE])).toBe(1)
	})

	it.each([
		[[]],
		[[TARGET]],
		[[TARGET, TARGET]],
		[[TARGET, 'x']],
		[[TARGET, DUPLICATE, '--title', ' ']],
		[[TARGET, DUPLICATE, '--bogus']],
	])('refuses %j with the usage and writes nothing', async (argv) => {
		expect(await issue_consolidate_cli.run(argv)).toBe(1)
		expect(consolidate).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Usage'))
	})
})
