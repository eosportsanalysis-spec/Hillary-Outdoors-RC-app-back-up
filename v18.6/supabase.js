import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL      || 'https://boclsssdwwiumkhqnypw.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_cQXFQhdnYtYqiu8iiQ6s9A_s3Q-17SC'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
export const hasSupabase = () => true

// ── PAGINATED FETCH ──────────────────────────────────────────────────────────
// Supabase / PostgREST has a server-side `db-max-rows` cap (default 1000) that
// .range() cannot override. To guarantee we get every row, we loop in pages
// until the server returns fewer rows than we asked for.
//
// Pages are 1000 rows by default — small enough to be safe, large enough to
// keep the request count low even for big tables (5k gear = 5 requests).
export async function sbGet(table, { pageSize = 1000, orderBy = null } = {}) {
  try {
    const all = []
    let from = 0
    // Hard ceiling so a runaway loop can't hang the UI. 50k is well above any
    // realistic gear count for one centre — adjust if needed.
    const MAX_ROWS = 50000

    while (from < MAX_ROWS) {
      let q = supabase.from(table).select('*').range(from, from + pageSize - 1)
      if (orderBy) q = q.order(orderBy)
      const { data, error } = await q
      if (error) {
        console.error(`sbGet ${table}:`, error.message)
        return all.length ? all : null
      }
      if (!data || data.length === 0) break
      all.push(...data)
      if (data.length < pageSize) break   // last page
      from += pageSize
    }
    return all
  } catch (e) {
    console.error(`sbGet ${table} exception:`, e)
    return null
  }
}

// ─── NOT-NULL coercion ──────────────────────────────────────────────────────
// Several gear columns are NOT NULL with defaults in the DB schema. When the
// app sends `null` explicitly (e.g. fuel items have no usage_limit), the DB
// rejects the row instead of falling back to the default. We pre-sanitise to
// either omit those keys (so PG uses its DEFAULT) or substitute sensible
// fallbacks. Per-table because the column set differs.
const NOT_NULL_DEFAULTS = {
  gear: {
    usage_limit:    0,            // schema: NOT NULL DEFAULT 200, but 0 = "untracked"
    number_of_uses: 0,
    signed_in_out:  'IN',
    status:         'Green',
    is_pool_bucket: false,
  },
  // categories: target_stock is NOT NULL DEFAULT 4
  categories: {
    target_stock:   4,
    life_safety:    false,
    behaviour:      'signable',
  },
}
function sanitiseRow(table, row) {
  const defaults = NOT_NULL_DEFAULTS[table]
  if (!defaults || !row) return row
  const out = { ...row }
  for (const [k, v] of Object.entries(defaults)) {
    if (out[k] === null || out[k] === undefined) out[k] = v
  }
  return out
}

export async function sbInsert(table, row) {
  try {
    const cleaned = sanitiseRow(table, row)
    const { data, error } = await supabase.from(table).insert(cleaned).select().single()
    if (error) { console.error(`sbInsert ${table}:`, error.message, '\n  payload:', cleaned); return null }
    return data
  } catch (e) { console.error(`sbInsert ${table} exception:`, e); return null }
}

// Bulk insert helper — for batch gear adds.
export async function sbInsertMany(table, rows) {
  if (!rows || !rows.length) return []
  try {
    const cleaned = rows.map(r => sanitiseRow(table, r))
    const { data, error } = await supabase.from(table).insert(cleaned).select()
    if (error) { console.error(`sbInsertMany ${table}:`, error.message); return null }
    return data
  } catch (e) { console.error(`sbInsertMany ${table} exception:`, e); return null }
}

export async function sbUpdate(table, match, patch) {
  try {
    const cleaned = sanitiseRow(table, patch)
    let q = supabase.from(table).update(cleaned)
    Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v) })
    const { data, error } = await q.select().single()
    if (error) { console.error(`sbUpdate ${table}:`, error.message, '\n  payload:', cleaned); return null }
    return data
  } catch (e) { console.error(`sbUpdate ${table} exception:`, e); return null }
}

export async function sbDelete(table, match) {
  try {
    let q = supabase.from(table).delete()
    Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v) })
    const { error } = await q
    if (error) { console.error(`sbDelete ${table}:`, error.message); return false }
    return true
  } catch (e) { console.error(`sbDelete ${table} exception:`, e); return false }
}

export async function sbUpsert(table, row, conflictCol) {
  try {
    const { data, error } = await supabase
      .from(table).upsert(row, { onConflict: conflictCol }).select().single()
    if (error) { console.error(`sbUpsert ${table}:`, error.message); return null }
    return data
  } catch (e) { console.error(`sbUpsert ${table} exception:`, e); return null }
}
