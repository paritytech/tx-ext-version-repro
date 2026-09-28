/**
 * Read the runtime's transaction-extension pipeline out of the metadata, and
 * walk a signed extrinsic's extension bytes slot by slot against it — so a
 * transaction that is one slot short says WHERE it goes wrong, instead of
 * papi's "innerDecoder is not a function".
 */
import { decAnyMetadata, unifyMetadata } from "@polkadot-api/substrate-bindings"
import { getDynamicBuilder, getLookupFn } from "@polkadot-api/metadata-builders"
import { hex, show } from "./report"

export interface Pipeline {
  /** identifiers in wire order */
  order: string[]
  /** the byte for `VerifyMultiSignature: Disabled`, when the pipeline has that slot */
  disabledSignature?: Uint8Array
}

const cache = new WeakMap<Uint8Array, { unified: ReturnType<typeof unifyMetadata>; pipeline: Pipeline }>()
function read(metadata: Uint8Array) {
  const hit = cache.get(metadata)
  if (hit) return hit
  const unified = unifyMetadata(decAnyMetadata(metadata))
  const slots = unified.extrinsic.signedExtensions[0] ?? []
  const verify = slots.find((s) => s.identifier === "VerifyMultiSignature")
  const def = verify && unified.lookup.find((e) => e.id === verify.type)?.def
  const disabled = def?.tag === "variant" ? def.value.find((v) => v.name === "Disabled" && v.fields.length === 0) : undefined
  const entry = {
    unified,
    pipeline: { order: slots.map((s) => s.identifier), disabledSignature: disabled ? Uint8Array.of(disabled.index) : undefined },
  }
  cache.set(metadata, entry)
  return entry
}

export const pipelineOf = (metadata: Uint8Array): Pipeline => read(metadata).pipeline

/** `0x84` v4 signed, `0x45` v5 general, `0x04`/`0x05` bare. */
export function formatOf(tx: Uint8Array): { version: number; kind: "bare" | "signed" | "general"; lengthBytes: number } {
  const first = tx[0]!
  const mode = first & 0b11
  const lengthBytes = mode === 0 ? 1 : mode === 1 ? 2 : mode === 2 ? 4 : 5 + (first >> 2)
  const byte = tx[lengthBytes]!
  return { version: byte & 0x3f, kind: byte & 0x80 ? "signed" : byte & 0x40 ? "general" : "bare", lengthBytes }
}

/**
 * Decode the extension bytes of a signed v4 / general v5 slot by slot. Reports
 * each slot's bytes and value, and stops at the first slot that does not
 * decode, naming the leftover bytes. Also says which pipeline slots the
 * extension list the CALLER forwarded lacks.
 */
export interface Forwarded {
  ids: string[]
  /** the forwarded `value` bytes, concatenated in order */
  extra: Uint8Array
}

export function walkExtensions(metadata: Uint8Array, tx: Uint8Array, forwarded: Forwarded, callData?: Uint8Array): string[] {
  const { unified, pipeline } = read(metadata)
  const builder = getDynamicBuilder(getLookupFn(unified))
  const format = formatOf(tx)
  const lines: string[] = []
  let off = format.lengthBytes + 1
  if (format.kind === "signed") off += 1 + 32 + 1 + 64 // MultiAddress::Id, MultiSignature::Sr25519
  else if (format.kind === "general") off += 1 // extension version byte
  lines.push(`format: extrinsic v${format.version} ${format.kind}; extensions start at byte ${off}`)
  const missing = pipeline.order.filter((id) => !forwarded.ids.includes(id))
  lines.push(`pipeline (${pipeline.order.length} slots): ${pipeline.order.join(", ")}`)
  lines.push(`forwarded by the caller: ${forwarded.ids.length} of them; NOT forwarded: ${missing.length ? missing.join(", ") : "none"}`)
  if (callData !== undefined && forwarded.ids.length) {
    const region = tx.subarray(off, tx.length - callData.length)
    const verbatim = hex(region) === hex(forwarded.extra)
    const callInPlace = hex(tx.subarray(tx.length - callData.length)) === hex(callData)
    lines.push(
      verbatim && callInPlace
        ? `the host's extension region (${region.length} bytes) is the ${forwarded.ids.length} forwarded values VERBATIM, then the call — nothing added for ${missing.length ? missing.join(", ") : "the slots it did not receive"}`
        : `the host's extension region (${region.length} bytes) holds ${region.length - forwarded.extra.length} byte(s) more than the caller's first request forwarded (${forwarded.extra.length}): a VerifyMultiSignature slot is present`,
    )
  }
  const slots = unified.extrinsic.signedExtensions[0] ?? []
  for (const slot of slots) {
    const start = off
    try {
      const [enc, dec] = builder.buildDefinition(slot.type)
      // a COPY: scale-ts reads from the start of the underlying buffer, so a subarray view decodes the wrong bytes
      const value = dec(tx.slice(off))
      off += enc(value).length
      lines.push(`  ${slot.identifier.padEnd(24)} ${(hex(tx.subarray(start, off)) === "0x" ? "(empty)" : hex(tx.subarray(start, off))).padEnd(24)} ${show(value)}`)
    } catch (error) {
      lines.push(`  ${slot.identifier.padEnd(24)} FAILS at byte ${off} on ${hex(tx.subarray(off, off + 12))}…: ${error instanceof Error ? error.message : String(error)}`)
      return lines
    }
  }
  lines.push(`  call data: ${hex(tx.subarray(off))}`)
  return lines
}
