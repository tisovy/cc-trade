import useFuturesLocalWorkstationConnection from './useFuturesLocalWorkstationConnection.js'

const useFuturesTestnetWorkstationConnection = ({ enabled }) => (
  useFuturesLocalWorkstationConnection({ enabled })
)

export default useFuturesTestnetWorkstationConnection
export { useFuturesTestnetWorkstationConnection }
