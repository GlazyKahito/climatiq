/** SQL helpers for region-scoped lists (shared by alerts, advisories and incidents). */
import { or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Condition "region path is within one of the scopes". `scopes` comes from `scopesFor()`; a `null` entry means
 * nationwide (no filter). Returns `undefined` for "no restriction" and a always-false condition for "no scopes".
 */
export function withinScopes(pathCol: AnyColumn | SQL, scopes: (string | null)[]): SQL | undefined {
  if (scopes.some((s) => s === null)) return undefined;
  const paths = [...new Set(scopes.filter((s): s is string => s != null))];
  if (!paths.length) return sql`false`;
  return or(...paths.map((p) => sql`(${pathCol} = ${p} or ${pathCol} like ${p + '/%'})`));
}

/** Condition "region path overlaps a scope" — within it OR an ancestor of it (e.g. a state advisory for a district user). */
export function overlapsScopes(pathCol: AnyColumn | SQL, scopes: (string | null)[]): SQL | undefined {
  if (scopes.some((s) => s === null)) return undefined;
  const paths = [...new Set(scopes.filter((s): s is string => s != null))];
  if (!paths.length) return sql`false`;
  return or(...paths.map((p) => sql`(${pathCol} = ${p} or ${pathCol} like ${p + '/%'} or ${p} like ${pathCol} || '/%')`));
}
