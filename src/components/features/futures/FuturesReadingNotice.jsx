import { useEffect, useState } from 'react'
import { describeFuturesReadingAgeNotice } from '../../../utils/futuresPriceReading.js'

// How old the reading behind a price is, counted while it is being read.
//
// A leaf on purpose. The age has to grow — a confirmation left open for half a
// minute must not still say the price is four seconds old — and that needs a
// tick a second. Putting the tick here keeps it off the ticket and the chart,
// which re-render on market data and have no business re-rendering on a clock.
//
// It renders nothing at all for a live reading, or for a price the operator
// typed. A line that is always on screen is a line nobody reads on the one
// occasion it matters.
export const FuturesReadingNotice = ({ reading, className }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const notice = describeFuturesReadingAgeNotice(reading, now)
  if (notice === null) return null
  return (
    <p className={`${className} is-${reading.state}`} role="status">{notice}</p>
  )
}

export default FuturesReadingNotice
