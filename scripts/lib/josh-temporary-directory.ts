// The scratch directory every agent writes into — Issue / PR bodies, plans, handoffs, logs. kit's
// distributed `.gitignore` ignores it, so `josh git`, which stages every untracked non-ignored file,
// never commits what is written here. One constant, because a body reader that refuses other places
// names this one, and the writers that default to it must not drift from the place it names.
const JOSH_TMP_DIRECTORY = '.josh/tmp'

export { JOSH_TMP_DIRECTORY }
