import React, { useEffect, useState } from 'react'
import { CButton, CFormSelect } from '@coreui/react'
import { cilSettings } from '@coreui/icons'
import { api } from '../../api/client'
import IconButton from '../../components/IconButton'
import { useDeviceLiveState } from '../../api/useLiveDevice'
import StatusIndicator from '../../components/indicators/StatusIndicator'
import AnnunciatorEditModal from './AnnunciatorEditModal'

const ERROR_COLOR = '#dc3545'
const WARNING_COLOR = '#ffc107'

// Warning/Error x 1-4, same 8-combination matrix Message Levels itself
// edits - this is a different selector though (which level to *simulate*
// while holding a Test button below, not a level's own beep pattern).
const LEVEL_OPTIONS = [
  ...[1, 2, 3, 4].map((level) => ({ value: `warning:${level}`, type: 'warning', level })),
  ...[1, 2, 3, 4].map((level) => ({ value: `error:${level}`, type: 'error', level })),
]

// One slot's pair of live LEDs - its own useDeviceLiveState calls, kept
// in a child component rather than called in a loop in the parent
// (Rules of Hooks - a fixed 8-slot map() over child instances is fine,
// a variable-length loop of hook calls in one component isn't).
const SlotIndicators = ({ redDeviceId, yellowDeviceId }) => {
  const red = useDeviceLiveState(redDeviceId)
  const yellow = useDeviceLiveState(yellowDeviceId)
  return (
    <div className="d-flex gap-2">
      <StatusIndicator active={red.value === true} color={ERROR_COLOR} />
      <StatusIndicator active={yellow.value === true} color={WARNING_COLOR} />
    </div>
  )
}

/**
 * Expandable-row detail for the "alarm-annunciator" process kind
 * (AGENTS_TO_DO.md, 2026-08-02) - 8 slots, each showing its bound Message
 * Group's name, live red/yellow LED state, and a click-and-hold Test
 * button (disabled while unbound - AGENTS_TO_DO.md's explicit follow-up)
 * that simulates that slot being active at the level picked in the
 * shared selector above, for as long as the button is held. Group
 * bindings themselves are edited in a separate modal (gear button),
 * matching HeartbeatEditModal/DataLoggerEditModal's own "Edit" idiom.
 */
const AnnunciatorPanel = ({ process, onConfigChange }) => {
  const [groups, setGroups] = useState([])
  const [levelValue, setLevelValue] = useState(LEVEL_OPTIONS[0].value)
  const [editVisible, setEditVisible] = useState(false)

  useEffect(() => {
    api
      .listMessageGroups()
      .then(setGroups)
      .catch(() => {})
  }, [])

  const slots = process.config.slots ?? []
  const selectedLevel = LEVEL_OPTIONS.find((option) => option.value === levelValue)
  const groupName = (id) => groups.find((group) => group.id === id)?.name

  const startTest = (index) => {
    api
      .setProcessConfig(process.id, {
        testSlotIndex: index,
        testLevel: { type: selectedLevel.type, level: selectedLevel.level },
      })
      .catch(() => {})
  }
  const stopTest = () => {
    api.setProcessConfig(process.id, { testSlotIndex: null }).catch(() => {})
  }

  return (
    <div className="p-3 pt-0">
      <div className="d-flex align-items-center gap-2 mb-3">
        <CFormSelect
          size="sm"
          style={{ width: '10rem' }}
          value={levelValue}
          onChange={(e) => setLevelValue(e.target.value)}
        >
          {LEVEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.type === 'warning' ? 'Warning' : 'Error'} {option.level}
            </option>
          ))}
        </CFormSelect>
        <span className="text-body-secondary small">test level</span>
        <div className="ms-auto">
          <IconButton
            icon={cilSettings}
            size="sm"
            center
            onClick={() => setEditVisible(true)}
            ariaLabel="Edit slot bindings"
          />
        </div>
      </div>

      {slots.map((slot, index) => (
        <div key={index} className="d-flex align-items-center gap-3 mb-2">
          <div style={{ width: '1.5rem' }} className="text-body-secondary small">
            {index + 1}
          </div>
          <div style={{ width: '10rem' }} className="small">
            {slot.messageGroupId !== null ? (
              groupName(slot.messageGroupId)
            ) : (
              <span className="text-body-secondary">Not bound</span>
            )}
          </div>
          <SlotIndicators redDeviceId={slot.redDeviceId} yellowDeviceId={slot.yellowDeviceId} />
          <CButton
            size="sm"
            color="secondary"
            variant="outline"
            disabled={slot.messageGroupId === null}
            onMouseDown={() => startTest(index)}
            onMouseUp={stopTest}
            onMouseLeave={stopTest}
          >
            Test
          </CButton>
        </div>
      ))}

      <AnnunciatorEditModal
        visible={editVisible}
        onClose={() => setEditVisible(false)}
        process={process}
        groups={groups}
        onSaved={(config) => {
          setEditVisible(false)
          onConfigChange(config)
        }}
      />
    </div>
  )
}

export default AnnunciatorPanel
