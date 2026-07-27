/**
 * Sidebar Navigation Configuration
 *
 * Defines the structure and content of the sidebar navigation menu.
 * Supports multiple navigation component types from CoreUI React:
 * - CNavItem: Single navigation link
 * - CNavGroup: Collapsible group of links
 * - CNavTitle: Section title/divider
 *
 * @module _nav
 */

import React from 'react'
import CIcon from '@coreui/icons-react'
import {
  cilBell,
  cilBug,
  cilDescription,
  cilDevices,
  cilHistory,
  cilPeople,
  cilSettings,
  cilSitemap,
  cilSpeedometer,
} from '@coreui/icons'
import { CNavItem, CNavTitle } from '@coreui/react'

/**
 * Navigation menu structure array
 *
 * @type {Array<Object>}
 * @property {React.ComponentType} component - CoreUI nav component (CNavItem, CNavGroup, CNavTitle)
 * @property {string} name - Display text for the nav item
 * @property {string} [to] - Internal route path (for CNavItem with routing)
 * @property {React.ReactNode} [icon] - Icon element to display
 * @property {boolean} [adminOnly] - Filtered out for non-admins in AppSidebar.jsx
 */
const _nav = [
  {
    component: CNavItem,
    name: 'Dashboard',
    to: '/dashboard',
    icon: <CIcon icon={cilSpeedometer} customClassName="nav-icon" />,
  },
  {
    component: CNavTitle,
    name: 'Devices',
  },
  {
    component: CNavItem,
    name: 'Nodes',
    to: '/nodes',
    icon: <CIcon icon={cilSitemap} customClassName="nav-icon" />,
  },
  {
    component: CNavItem,
    name: 'Devices',
    to: '/devices',
    icon: <CIcon icon={cilDevices} customClassName="nav-icon" />,
  },
  {
    component: CNavItem,
    name: 'Dev Simulator',
    to: '/dev-simulator',
    icon: <CIcon icon={cilBug} customClassName="nav-icon" />,
  },
  {
    component: CNavTitle,
    name: 'Orchestration',
  },
  {
    component: CNavItem,
    name: 'Processes',
    to: '/processes',
    icon: <CIcon icon={cilSettings} customClassName="nav-icon" />,
  },
  {
    component: CNavTitle,
    name: 'Logs',
  },
  {
    component: CNavItem,
    name: 'Live Events',
    to: '/live-events',
    icon: <CIcon icon={cilBell} customClassName="nav-icon" />,
  },
  {
    component: CNavItem,
    name: 'Logs',
    to: '/logs',
    icon: <CIcon icon={cilHistory} customClassName="nav-icon" />,
  },
  {
    component: CNavTitle,
    name: 'Settings',
  },
  {
    component: CNavItem,
    name: 'Users',
    to: '/users',
    icon: <CIcon icon={cilPeople} customClassName="nav-icon" />,
    // Filtered out for non-admins in AppSidebar.jsx (AGENTS.md section 13) -
    // the server-side 403 on /users is the real guard, this just avoids
    // showing a link that would fail for most signed-in users.
    adminOnly: true,
  },
  {
    component: CNavItem,
    name: 'Docs',
    to: '/docs',
    icon: <CIcon icon={cilDescription} customClassName="nav-icon" />,
  },
]

export default _nav
