import { vi } from 'vitest'

// Finds a captured console line by fragment. Shared by the `latest:update` test files, which each
// assert on a different console channel but read the recorded calls back the same way.
function find_logged(spy: typeof console.info, fragment: string): string | undefined {
	return vi
		.mocked(spy)
		.mock.calls.map(([first]) => (typeof first === 'string' ? first : ''))
		.find((line) => line.includes(fragment))
}

const logged_lines = { find_logged }

export { logged_lines }
