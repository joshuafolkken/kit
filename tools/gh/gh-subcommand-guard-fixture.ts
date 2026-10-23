// The module `gh-subcommand-guard.test.ts` imports a binary name from, so that the guard's own
// import resolution is exercised against a real file on disk rather than against a stub. A stub
// would let the resolution pass while the specifier-to-path mapping was wrong, which is the half
// of the feature that can actually be written wrong.
//
// Two constants rather than one: the second is what shows that resolving an imported name does not
// by itself report a spawn — only a name that resolves to `gh` does.
//
// `*-fixture.ts` is excluded from the published package (`package.json` → `files`).
const FIXTURE_GH_BINARY = 'gh'
const FIXTURE_GIT_BINARY = 'git'

export { FIXTURE_GH_BINARY, FIXTURE_GIT_BINARY }
