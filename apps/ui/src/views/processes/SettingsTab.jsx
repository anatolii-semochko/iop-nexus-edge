import React from 'react'
import { CCard, CCardBody, CCardHeader } from '@coreui/react'
import { api } from '../../api/client'
import NamedListManager from '../../components/NamedListManager'
import MessageLevelsForm from './MessageLevelsForm'

/**
 * Settings tab (AGENTS.md section 22) - four admin-config forms. Process
 * Groups moved here from the old "Manage groups" popup (ProcessesList.jsx,
 * removed); Tab Groups, Message Groups, and Message Levels are all new.
 *
 * Process Groups / Tab Groups / Message Groups are three genuinely
 * separate entities that happen to share the same "named list, many-to-
 * many with processes" shape - see each section's own comment for why
 * they're not the same thing.
 */
const SettingsTab = ({
  groups,
  reloadGroups,
  reloadProcesses,
  tabGroups,
  reloadTabGroups,
  messageGroups,
  reloadMessageGroups,
  onError,
}) => {
  const wrap =
    (fn) =>
    async (...args) => {
      try {
        await fn(...args)
      } catch (err) {
        onError(err.message)
        throw err
      }
    }

  return (
    <div className="d-flex flex-column gap-4">
      {/* The *technical* system a process belongs to (heating, lighting,
          security, aquarium...) - drives the Group column/filter. */}
      <CCard>
        <CCardHeader>Process Groups</CCardHeader>
        <CCardBody>
          <NamedListManager
            addLabel="Add Group"
            namePlaceholder="Group name"
            items={groups}
            onAdd={wrap(async (name) => {
              await api.createProcessGroup(name)
              reloadGroups()
            })}
            onRename={wrap(async (id, name) => {
              await api.renameProcessGroup(id, name)
              reloadGroups()
              reloadProcesses()
            })}
            onDelete={wrap(async (id) => {
              await api.deleteProcessGroup(id)
              reloadGroups()
            })}
          />
        </CCardBody>
      </CCard>

      {/* An operator's own curated workspace - whichever processes they
          personally want to watch, regardless of Process Group. Ordered:
          each one is also a dynamic page tab, in this order. */}
      <CCard>
        <CCardHeader>Tab Groups</CCardHeader>
        <CCardBody>
          <NamedListManager
            addLabel="Add Group"
            namePlaceholder="Tab group name"
            items={tabGroups}
            orderable
            onAdd={wrap(async (name) => {
              await api.createTabGroup(name)
              reloadTabGroups()
            })}
            onRename={wrap(async (id, name) => {
              await api.renameTabGroup(id, name)
              reloadTabGroups()
            })}
            onDelete={wrap(async (id) => {
              await api.deleteTabGroup(id)
              reloadTabGroups()
            })}
            onReorder={wrap(async (orderedIds) => {
              await api.reorderTabGroups(orderedIds)
              reloadTabGroups()
            })}
          />
        </CCardBody>
      </CCard>

      {/* WEM notification routing - which recipient gets which processes'
          warnings/errors/messages. Not tied to Process Groups (an
          operator doesn't necessarily watch one whole system) or Tab
          Groups (a workspace curation concern, not a routing one). No
          ordering - nothing here drives a tab. */}
      <CCard>
        <CCardHeader>Message Groups</CCardHeader>
        <CCardBody>
          <NamedListManager
            addLabel="Add Group"
            namePlaceholder="Message group name"
            items={messageGroups}
            onAdd={wrap(async (name) => {
              await api.createMessageGroup(name)
              reloadMessageGroups()
            })}
            onRename={wrap(async (id, name) => {
              await api.renameMessageGroup(id, name)
              reloadMessageGroups()
            })}
            onDelete={wrap(async (id) => {
              await api.deleteMessageGroup(id)
              reloadMessageGroups()
            })}
          />
        </CCardBody>
      </CCard>

      <CCard>
        <CCardHeader>Message Levels</CCardHeader>
        <CCardBody>
          <MessageLevelsForm />
        </CCardBody>
      </CCard>
    </div>
  )
}

export default SettingsTab
