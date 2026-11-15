import { isDeepStrictEqual } from 'node:util'
import { json_value } from '#scripts/lib/json-value'

// **`package.json` is a whole-suite file only for what is not its `version`** (joshuafolkken/kit#7538).
// The release commit moves the version alone, which neither dependency resolution nor the vitest
// config reads, so such a change reaches the tests reading `package.json` through the test-read map
// rather than every test. Any other key — a dependency, a script, the `pnpm` field — still runs the
// whole suite.

const PACKAGE_PATH = 'package.json'
const VERSION_KEY = 'version'

function without_version(text: string): Record<string, unknown> | undefined {
	const value = json_value.parse_or_undefined(text)
	if (!json_value.is_record(value)) return undefined

	return Object.fromEntries(Object.entries(value).filter(([key]) => key !== VERSION_KEY))
}

// Whether the two texts differ in `version` alone — false when either is not a JSON object.
function is_version_only(before: string, after: string): boolean {
	const was = without_version(before)
	const is = without_version(after)

	return was !== undefined && is !== undefined && isDeepStrictEqual(was, is)
}

const package_version_only = { PACKAGE_PATH, is_version_only }

export { package_version_only }
