import React, { useEffect, useState } from 'react'
import { CCard, CCardBody, CCardHeader, CTab, CTabList, CTabs } from '@coreui/react'
import { api } from '../../api/client'
import DeviceCommandLogsTab from './DeviceCommandLogsTab'
import ProcessMessageLogsTab from './ProcessMessageLogsTab'
import SensorReadingLogsTab from './SensorReadingLogsTab'

const TAB_DEFS = [
  { key: 'deviceCommands', label: 'Device Commands' },
  { key: 'sensors', label: 'Sensors' },
  { key: 'processes', label: 'Processes' },
]

/**
 * Logs page (AGENTS.md section 29) - a tabbed historical browser over the
 * three append-only log tables (device_command_logs, sensor_reading_logs,
 * process_messages), following the same CTabs/CTabList pattern as the
 * Processes page (section 22) rather than CTabContent/CTabPanel, so an
 * inactive tab doesn't keep fetching/pagination state mounted for no
 * reason. Devices/processes are fetched once here (cheap, a few dozen
 * rows) and passed down for each tab's own selector dropdown.
 */
const LogsList = () => {
  const [activeTab, setActiveTab] = useState('deviceCommands')
  const [devices, setDevices] = useState([])
  const [processes, setProcesses] = useState([])

  useEffect(() => {
    api
      .listDevices()
      .then(setDevices)
      .catch(() => {})
  }, [])
  useEffect(() => {
    api
      .listProcesses()
      .then(setProcesses)
      .catch(() => {})
  }, [])

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Logs</strong>
      </CCardHeader>
      <CCardBody>
        <CTabs activeItemKey={activeTab} onChange={setActiveTab}>
          <CTabList variant="tabs" className="mb-3">
            {TAB_DEFS.map((tab) => (
              <CTab key={tab.key} itemKey={tab.key}>
                {tab.label}
              </CTab>
            ))}
          </CTabList>
        </CTabs>
        {activeTab === 'deviceCommands' && <DeviceCommandLogsTab devices={devices} />}
        {activeTab === 'sensors' && <SensorReadingLogsTab devices={devices} />}
        {activeTab === 'processes' && <ProcessMessageLogsTab processes={processes} />}
      </CCardBody>
    </CCard>
  )
}

export default LogsList
