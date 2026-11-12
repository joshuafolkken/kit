import { afterEach, describe, expect, it, vi } from 'vitest'
import { publish_tag_cli } from './publish-tag-cli'

const COMMAND = ['node', 'publish-tag-cli.ts']

afterEach(() => {
	vi.restoreAllMocks()
})

describe('publish_tag_cli.main — the tag `josh release:tag` prints for publish.yml', () => {
	it.each([
		['latest', '1.2.0', '1.1.0'],
		['backfill', '1.1.0', '1.2.0'],
	])('prints %s for %s over current latest %s', (expected, version, latest) => {
		const info = vi.spyOn(console, 'info').mockImplementation(vi.fn())

		publish_tag_cli.main([...COMMAND, version, latest])

		expect(info).toHaveBeenCalledWith(expected)
	})

	it('rejects a missing current latest', () => {
		expect(() => publish_tag_cli.main([...COMMAND, '1.2.0'])).toThrow('are required')
	})
})
