/**
 * Walk a transaction's extension bytes slot by slot against the chain's live
 * metadata, in Node: `npm run walk -- <0xhex> [<0xhex>…]`.
 * (The truapi-host script runner executes scripts under bun; the walk lives
 * here too so its verdict can be checked outside that engine.)
 */
import { connectPeople } from "../lib/chain"
import { walkExtensions } from "../lib/decode"

const conn = connectPeople()
try {
  const raw: unknown =
    (await conn.api.apis.Metadata.metadata_at_version(16)) ?? (await conn.api.apis.Metadata.metadata_at_version(15))
  if (!raw) throw new Error("the chain serves neither metadata v16 nor v15")
  const metadata: Uint8Array =
    raw instanceof Uint8Array
      ? raw
      : typeof raw === "string"
        ? Uint8Array.from(Buffer.from(raw.replace(/^0x/, ""), "hex"))
        : (raw as { asBytes(): Uint8Array }).asBytes()
  console.log(`metadata: ${metadata.length} bytes (papi returned a ${(raw as object).constructor.name})`)
  for (const hex of process.argv.slice(2)) {
    console.log(`\n${hex.slice(0, 40)}…`)
    const tx = Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"))
    for (const line of walkExtensions(metadata, tx, { ids: [], extra: new Uint8Array() })) console.log("  " + line)
  }
} finally {
  conn.client.destroy()
}
