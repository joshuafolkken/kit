// joshuafolkken/kit#8944: the icons of the `queued` and `waiting` section headings. A heading's icon reads
// as a rule in the emoji-free board (joshuafolkken/kit#8154), but `⏳` and `🔗` also mark rows (`HD`, `LK`),
// so each heading takes an icon of its own that the glyph table maps to `--`.

const QUEUED_HEADING_ICON = '⌛'
const WAITING_HEADING_ICON = '🪢'

const run_board_heading_icons = { QUEUED_HEADING_ICON, WAITING_HEADING_ICON }

export { run_board_heading_icons }
