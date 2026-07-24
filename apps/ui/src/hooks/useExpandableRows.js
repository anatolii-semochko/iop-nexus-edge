/**
 * Row-expansion logic (isExpanded/toggleOne/allExpanded/toggleAll) shared
 * by any table with expandable-detail rows (AGENTS.md section 17) - first
 * built for Processes, generic from day one so the next page that wants
 * expandable rows only needs this hook plus `components/table/
 * ExpandToggleButton.jsx` / `ExpandAllToggleButton.jsx`, no copy-pasted
 * Set-juggling.
 *
 * Owns no state itself - `expandedIds` (a plain array, so it can live
 * directly in usePersistedState/plain useState/anything else) and its
 * setter are the caller's. `toggleAll`/`allExpanded` take the currently
 * relevant id list as an argument rather than binding it once, since
 * "which rows are visible right now" is page-specific (e.g. only the
 * current page of a paginated table) and changes every render.
 *
 * @param {Array<string|number>} expandedIds
 * @param {(ids: Array<string|number>) => void} setExpandedIds
 */
export function useExpandableRows(expandedIds, setExpandedIds) {
  const isExpanded = (id) => expandedIds.includes(id)

  const toggleOne = (id) => {
    setExpandedIds(isExpanded(id) ? expandedIds.filter((x) => x !== id) : [...expandedIds, id])
  }

  const allExpanded = (ids) => ids.length > 0 && ids.every(isExpanded)

  const toggleAll = (ids) => {
    if (allExpanded(ids)) {
      setExpandedIds(expandedIds.filter((id) => !ids.includes(id)))
    } else {
      setExpandedIds([...new Set([...expandedIds, ...ids])])
    }
  }

  return { isExpanded, toggleOne, allExpanded, toggleAll }
}
