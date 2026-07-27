/**
 * Application Routes Configuration
 *
 * Defines all protected routes in the application using React lazy loading
 * for code splitting and performance optimization.
 *
 * Each route object contains:
 * - path: URL path for the route
 * - name: Human-readable name for breadcrumbs
 * - element: Lazy-loaded React component
 * - exact: (optional) Requires exact path match
 *
 * @module routes
 */

import React from 'react'

const Dashboard = React.lazy(() => import('./views/dashboard/Dashboard'))
const Docs = React.lazy(() => import('./views/docs/Docs'))

// Devices
const NodesList = React.lazy(() => import('./views/devices/NodesList'))
const DevicesList = React.lazy(() => import('./views/devices/DevicesList'))
const DeviceDetail = React.lazy(() => import('./views/devices/DeviceDetail'))
const DevSimulator = React.lazy(() => import('./views/devices/DevSimulator'))

// Processes
const ProcessesList = React.lazy(() => import('./views/processes/ProcessesList'))

// Logs
const LiveEvents = React.lazy(() => import('./views/logs/LiveEvents'))
const LogsList = React.lazy(() => import('./views/logs/LogsList'))

// Users
const UsersList = React.lazy(() => import('./views/users/UsersList'))

/**
 * Array of route configuration objects
 *
 * @type {Array<Object>}
 * @property {string} path - URL path pattern
 * @property {string} name - Display name for breadcrumbs and navigation
 * @property {React.LazyExoticComponent} element - Lazy-loaded component
 * @property {boolean} [exact] - Whether to match path exactly
 *
 * @example
 * // Route renders when URL matches '/dashboard'
 * { path: '/dashboard', name: 'Dashboard', element: Dashboard }
 *
 * @example
 * // Route with exact match required
 * { path: '/base', name: 'Base', element: Cards, exact: true }
 */
export const routes = [
  { path: '/', exact: true, name: 'Home' },
  { path: '/dashboard', name: 'Dashboard', element: Dashboard },
  { path: '/docs', name: 'Docs', element: Docs },
  { path: '/nodes', name: 'Nodes', element: NodesList },
  { path: '/devices', name: 'Devices', element: DevicesList, exact: true },
  { path: '/devices/:id', name: 'Device Detail', element: DeviceDetail },
  { path: '/dev-simulator', name: 'Dev Simulator', element: DevSimulator },
  { path: '/processes', name: 'Processes', element: ProcessesList },
  { path: '/live-events', name: 'Live Events', element: LiveEvents },
  { path: '/logs', name: 'Logs', element: LogsList },
  { path: '/users', name: 'Users', element: UsersList },
]

export default routes
