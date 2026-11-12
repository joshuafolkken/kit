import os from 'node:os'

// A string drawn on a screen with the home directory written out as `~`: the absolute path carries
// the OS account name, which is often the user's real name and leaks in a screenshot or a recording
// (joshuafolkken/kit#7342). A home that is the root, or unknown, names no account and is left as is.
const TILDE = '~'
const ROOT = '/'
// The home only where a path segment ends, so a sibling account such as `/Users/anna` beside
// `/Users/ann` is not drawn as `~a`.
const SEGMENT_CONTINUES = /^[\w.-]/u

function mask(text: string): string {
	const home = os.homedir()
	if (home === '' || home === ROOT) return text

	const [head = '', ...rest] = text.split(home)
	const masked = rest.map((part) => `${SEGMENT_CONTINUES.test(part) ? home : TILDE}${part}`)

	return `${head}${masked.join('')}`
}

const home_tilde = { mask }

export { home_tilde }
