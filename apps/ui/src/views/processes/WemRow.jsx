import React from 'react'
import { api } from '../../api/client'
import { wemBadgeClass } from '../../utils/wem'

/**
 * WEM (Warnings/Errors/Messages) list (AGENTS.md section 22) - rendered as
 * the tail end of a process's own detail panel (ProcessesList.jsx's
 * ProcessRow), not as its own table row anymore: showing/hiding messages
 * used to add or remove a whole row independent of expand/collapse, which
 * made every other row in the table visibly jump up/down as conditions
 * came and went. Nesting it inside the already-expandable panel cell means
 * it only appears once the user has deliberately opened that process, so
 * it can no longer perturb the collapsed table's layout.
 *
 * `messages` is already sorted (errors, then warnings, then plain
 * messages, most severe/oldest first within each - processMessages.
 * listActiveMessages) - this just numbers and colors what it's given.
 *
 * Dismiss (the `.btn-close`) only applies to `type: "message"` - an
 * error/warning is tied to a live condition and stays visible for as long
 * as that condition holds, with no user-facing way to hide it early; only
 * a one-shot `message` (no ongoing condition to clear) leaves the active
 * list via the user reading and dismissing it.
 */
const WemRow = ({ messages }) => {
  if (messages.length === 0) return null

  const handleDismiss = async (messageId) => {
    await api.hideMessage(messageId)
  }

  return (
    <div className="px-3 pb-2">
      {messages.map((message, index) => (
        <div
          key={message.id}
          className={`d-flex align-items-center justify-content-between px-3 py-2 mb-1 ${wemBadgeClass(message.type)}`}
        >
          <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>
            {index + 1}. {message.text}
          </span>
          {message.type === 'message' && (
            <button
              type="button"
              className="btn-close"
              aria-label="Dismiss"
              onClick={() => handleDismiss(message.id)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export default WemRow
