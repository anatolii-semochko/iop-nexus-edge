import React from 'react'

/**
 * Type-column deep link (AGENTS_TO_DO.md, 2026-08-30) - a Node/Device/
 * Process row's own type/kind column, rendered as a plain "link" so the
 * column stays a fixed width regardless of how long the actual type name
 * is; the real name only shows on hover (title) and opens
 * LibraryBrowser.jsx's own type-filter deep link in a new tab, leaving
 * the current table where it is.
 */
const LibraryTypeLink = ({ kind, typeName }) => {
  if (!typeName) return '-'
  return (
    <a
      href={`#/library?kind=${encodeURIComponent(kind)}&type=${encodeURIComponent(typeName)}`}
      target="_blank"
      rel="noreferrer"
      title={typeName}
      className="link-primary text-decoration-none"
    >
      link
    </a>
  )
}

export default LibraryTypeLink
