// One width for every asynchronous `gh` spawn, so `Promise.all` fan-outs anywhere (`backlog:next`
// reads up to hundreds) stay under GitHub's secondary rate limit. Kept apart from `git-gh-exec.ts`
// so a test that mocks the spawn layer wholesale does not take the width away from its callers.
const GH_SPAWN_CONCURRENCY = 8

export { GH_SPAWN_CONCURRENCY }
