import { afterEach, expect, it, vi } from 'vitest'
import { issue_file_cli } from './issue-file-cli'

afterEach(() => {
	vi.restoreAllMocks()
})

it('advertises the three solo answers when an invocation is invalid', async () => {
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	await issue_file_cli.run([])
	const usage = error.mock.calls.flat().join('\n')

	expect(usage).toContain('--defect yes|no|unknown')
	expect(usage).toContain('--verification yes|no|unknown')
	expect(usage).toContain('--every-run yes|no|unknown')
})
