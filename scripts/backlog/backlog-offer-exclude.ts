const LIST_SEPARATOR = ','

// **A child in flight is never offered**, nor a settled one `backlog:next` still reads OPEN — merged, or
// withdrawn from this run (joshuafolkken/kit#4365). The drive builds this list from its state and the
// stall detector from the event stream (joshuafolkken/kit#4349); both go through here. Kept free of the
// drive's imports so a reader of the stream does not load it.
function exclude_of(settled: Iterable<string>, in_flight: Iterable<string>): ReadonlyArray<string> {
	return [...new Set([...settled, ...in_flight])]
}

function exclude_argv(exclude: ReadonlyArray<string>): ReadonlyArray<string> {
	return exclude.length === 0 ? [] : ['--exclude', exclude.join(LIST_SEPARATOR)]
}

export const backlog_offer_exclude = { exclude_argv, exclude_of }
