'use strict';
/**
 * BlackSand dashboard — Monday GraphQL query builders (Phase 6).
 *
 * Queries are composed from structured field selections and ALWAYS pass runtime
 * values (board id, cursor, limit, column ids) through GraphQL `variables` — user/
 * config values are NEVER concatenated into the query text (no injection, no ad-hoc
 * string building). These are pure functions returning `{ query, variables }`. No
 * request is executed here.
 */

// A tagged template that just collapses indentation — makes queries readable without
// concatenating dynamic values into them.
function gql(strings, ...expr) {
  // expr are only used for STATIC sub-selections (field lists), never runtime values.
  return strings.reduce((acc, s, i) => acc + s + (i < expr.length ? String(expr[i]) : ''), '')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// Column-value sub-selection shared by every item query. Column IDs are supplied at
// runtime via the $columnIds variable, so this selection text is static.
const COLUMN_VALUES = 'column_values(ids: $columnIds) { id type text value }';
// `group` is fetched so a board can derive its category from group membership
// (categorySource: 'group') — some boards model retail/office as groups, not a column.
const ITEM_FIELDS = `id name updated_at group { id title } ${COLUMN_VALUES}`;

/** First page of a board's items. */
function boardItemsQuery() {
  return gql`
    query BoardItems($boardId: ID!, $limit: Int!, $columnIds: [String!]) {
      boards(ids: [$boardId]) {
        id
        name
        items_page(limit: $limit) {
          cursor
          items { ${ITEM_FIELDS} }
        }
      }
    }`;
}

/** Subsequent pages via the cursor returned by the previous page. */
function nextItemsPageQuery() {
  return gql`
    query NextItems($cursor: String!, $limit: Int!, $columnIds: [String!]) {
      next_items_page(cursor: $cursor, limit: $limit) {
        cursor
        items { ${ITEM_FIELDS} }
      }
    }`;
}

/** Board metadata + column/group definitions (to validate a mapping against the live board). */
function boardMetaQuery() {
  return gql`
    query BoardMeta($boardId: ID!) {
      boards(ids: [$boardId]) {
        id
        name
        state
        groups { id title }
        columns { id title type }
      }
    }`;
}

/** Build a first-page request. Values go through `variables` only. */
function firstPageRequest({ boardId, columnIds, limit }) {
  return { query: boardItemsQuery(), variables: { boardId: String(boardId), columnIds: columnIds || null, limit } };
}
/** Build a next-page request from a cursor. */
function nextPageRequest({ cursor, columnIds, limit }) {
  return { query: nextItemsPageQuery(), variables: { cursor: String(cursor), columnIds: columnIds || null, limit } };
}
/** Build a board-metadata request. */
function boardMetaRequest({ boardId }) {
  return { query: boardMetaQuery(), variables: { boardId: String(boardId) } };
}

module.exports = {
  gql,
  boardItemsQuery,
  nextItemsPageQuery,
  boardMetaQuery,
  firstPageRequest,
  nextPageRequest,
  boardMetaRequest,
};
