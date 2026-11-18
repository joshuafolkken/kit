// The Issue a fold option ships this one in (joshuafolkken/kit#7985): the `--into #M` of a permission
// line naming `lane:fold <N> --into #<M>` under the parent permission, which `backlog:triage --adopt` passes to `lane:fold`.

const INTO = /--into +#?([1-9]\d*)\b/u

// The bare Issue number after `--into`, or `undefined` for a permission line naming none.
function into_of(permission: string | undefined): string | undefined {
	return permission === undefined ? undefined : INTO.exec(permission)?.[1]
}

const run_park_fold = { into_of }

export { run_park_fold }
