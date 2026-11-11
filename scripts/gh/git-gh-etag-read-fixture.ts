import type { ReadDetail } from './git-gh-etag-read'
import { git_gh_exec } from './git-gh-exec'

// `git_gh_etag_read` read straight through `exec_gh_api`, for the suites that mock that request and
// count it: no ETag is sent, so no page answers 304. Shared so the stand-in follows the module's
// surface in one place (joshuafolkken/kit#7306).

async function read(path: string): Promise<string> {
	return await git_gh_exec.exec_gh_api({ path })
}

async function read_detail(path: string): Promise<ReadDetail> {
	return { body: await read(path), is_unchanged: false }
}

const git_gh_etag_read_fixture = { through_exec: { read, read_detail } }

export { git_gh_etag_read_fixture }
