import path from 'node:path'

// `--path <dir>` names the target project whose transcripts to read, resolved to an absolute path
// (joshuafolkken/kit#1987). The transcript slug is derived from the exact cwd string and
// `~/.claude/projects/<slug>` was written from an absolute one, so a relative `--path` would slugify
// to a folder that was never written. Shared by `josh cost` and `josh time` so the two resolve a
// target identically — a second copy of this rule is how one of the two quietly stops finding it.
function resolve(target: string | undefined, cwd: string): string {
	return target === undefined ? cwd : path.resolve(target)
}

const transcript_cwd = { resolve }

export { transcript_cwd }
