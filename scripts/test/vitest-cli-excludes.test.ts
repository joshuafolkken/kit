import { describe, expect, it } from 'vitest'
import { vitest_cli_excludes } from './vitest-cli-excludes'

const { EXCLUDE_FLAG, cli_excludes } = vitest_cli_excludes

describe('vitest_cli_excludes.cli_excludes — the files a command line leaves out', () => {
	it('returns the value of every --exclude, and nothing without one', () => {
		const argv = [
			'vitest',
			'related',
			EXCLUDE_FLAG,
			'a.test.ts',
			'--run',
			EXCLUDE_FLAG,
			'b.test.ts',
		]

		expect(cli_excludes(argv)).toEqual(['a.test.ts', 'b.test.ts'])
		expect(cli_excludes(['vitest', 'run'])).toEqual([])
	})
})
