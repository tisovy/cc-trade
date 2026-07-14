import useFuturesLocalWorkstationConnection from './useFuturesLocalWorkstationConnection.js'

const useFuturesProductionWorkstationConnection = ({ enabled }) => (
  useFuturesLocalWorkstationConnection({ enabled })
)

export default useFuturesProductionWorkstationConnection
export { useFuturesProductionWorkstationConnection }
