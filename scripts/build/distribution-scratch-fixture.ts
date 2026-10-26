// The prefixes of the private directories the build tests create under `dist/`, single-sourced so the
// tests that create them and `pack-boundary.test.ts`, which proves `package.json`'s `files` excludes
// them, cannot drift apart (joshuafolkken/kit#5053). A prefix `files` does not exclude lets a
// concurrent `pnpm pack` read a directory its test is removing.
const COMMANDS_TEST_PREFIX = '.commands-test-'
const DISPATCH_TEST_PREFIX = '.dispatch-test-'

export { COMMANDS_TEST_PREFIX, DISPATCH_TEST_PREFIX }
