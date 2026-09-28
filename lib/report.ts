/** A tiny timestamped reporter, so every door that opens or shuts is one line. */
export const show = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? hex(x) : x)) ?? String(v)

export const hex = (bytes: Uint8Array): `0x${string}` => `0x${Buffer.from(bytes).toString("hex")}`

const t0 = Date.now()
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`

export const log = (line: string) => console.log(`${stamp()}  ${line}`)
export const ok = (label: string, detail?: unknown) =>
  log(`OK  ${label}${detail === undefined ? "" : `: ${show(detail).slice(0, 300)}`}`)
export const bad = (label: string, detail?: unknown) =>
  log(`BAD ${label}${detail === undefined ? "" : `: ${show(detail).slice(0, 300)}`}`)

/** Report and throw — the truapi-host runner turns a throw into a non-zero exit. */
export function fail(label: string, detail?: unknown): never {
  log(`ERR ${label}${detail === undefined ? "" : `: ${show(detail)}`}`)
  throw new Error(`${label} failed`)
}
