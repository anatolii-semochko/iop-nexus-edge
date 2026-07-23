import React from 'react'
import { CBadge } from '@coreui/react'
import { useLiveConnectionStatus } from '../../api/useLiveDevice'

/** Small indicator for the shared live WebSocket (apps/messaging-gateway, AGENTS.md section 9). */
const LiveBadge = () => {
  const connected = useLiveConnectionStatus()
  return <CBadge color={connected ? 'success' : 'secondary'}>{connected ? 'Live' : 'Live (reconnecting)'}</CBadge>
}

export default LiveBadge
