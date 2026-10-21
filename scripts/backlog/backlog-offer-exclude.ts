const LIST_SEPARATOR = ','

// **A child in flight is never offered**, nor a merged one `backlog:next` still reads OPEN. The drive
// builds this list from its state and the stall detector from the event stream (joshuafolkken/kit#4349);
// both go through here. Kept free of the drive's imports so a reader of the stream does not load it.
function exclude_of(merged: Iterable<string>, in_flight: Iterable<string>): ReadonlyArray<string> {
	return [...new Set([...merged, ...in_flight])]
}

function exclude_argv(exclude: ReadonlyArray<string>): ReadonlyArray<string> {
	return exclude.length === 0 ? [] : ['--exclude', exclude.join(LIST_SEPARATOR)]
}

export const backlog_offer_exclude = { exclude_argv, exclude_of }
