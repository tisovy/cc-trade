// One reading of a timestamp, for every table on the desk.
//
// A row from today is read for its time of day and an older one for its day, so
// each shows the half it is read for: `10.08 11:21:34` is fourteen characters in
// a cell that has room for eight, and it ellipsized away exactly the seconds
// that separate one fill from the next. Nothing is lost — the whole stamp stays
// in the element's title.

const startOfToday = () => {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  return midnight.getTime()
}

const usable = timestamp => Number.isSafeInteger(timestamp) && timestamp > 0

export const formatFuturesDeskTime = (timestamp, absent = '—') => {
  if (!usable(timestamp)) return absent
  const date = new Date(timestamp)
  return date.getTime() >= startOfToday()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
}

export const exactFuturesDeskTime = timestamp => (
  usable(timestamp) ? new Date(timestamp).toLocaleString() : undefined
)
