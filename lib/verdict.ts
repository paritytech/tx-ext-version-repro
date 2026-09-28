/**
 * Two verdicts on a built transaction, both straight from the node over a raw
 * socket of their own: the runtime's `TaggedTransactionQueue_validate_transaction`
 * (no funds needed, nothing broadcast), and with `SUBMIT=1` a broadcast through
 * `author_submitAndWatchExtrinsic` (the account pays the fee).
 */
import { NETWORK } from "./chain"
import { bad, hex, log, ok, show } from "./report"
import { rpcCall, submitAndWatch } from "./rpc"

const runtimePanicked = (text: string) => /unreachable|wasm trap|panicked/.test(text)

const INVALID = ["Call", "Payment", "Future", "Stale", "BadProof", "AncientBirthBlock", "ExhaustsResources", "Custom", "BadMandatory", "MandatoryValidation", "BadSigner"]
const UNKNOWN = ["CannotLookup", "NoUnsignedValidator", "Custom"]

/** `TaggedTransactionQueue_validate_transaction(External, tx, at)`, result decoded by hand. */
export async function runtimeVerdict(tx: Uint8Array): Promise<boolean> {
  const at = await rpcCall<string>(NETWORK.peopleWs, "chain_getFinalizedHead", [])
  const params = hex(Uint8Array.from([2, ...tx, ...Buffer.from(at.slice(2), "hex")]))
  let result: string
  try {
    result = await rpcCall<string>(NETWORK.peopleWs, "state_call", ["TaggedTransactionQueue_validate_transaction", params, at])
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    if (runtimePanicked(text)) bad("runtime validate_transaction: the runtime PANICS decoding the transaction (wasm trap)")
    else bad("runtime validate_transaction: call failed", text.slice(0, 200))
    return false
  }
  const bytes = Buffer.from(result.slice(2), "hex")
  if (bytes[0] === 0) {
    ok("runtime validate_transaction: VALID")
    return true
  }
  const kind = bytes[1] === 0 ? "Invalid" : "Unknown"
  const variant = (bytes[1] === 0 ? INVALID : UNKNOWN)[bytes[2]!] ?? `#${bytes[2]}`
  if (kind === "Invalid" && variant === "Payment") {
    ok("runtime validate_transaction: Invalid.Payment — the bytes decode; the account only lacks fee funds")
    return true
  }
  bad(`runtime validate_transaction: ${kind}.${variant}`, result)
  return false
}

/** `author_submitAndWatchExtrinsic` until the transaction is in a block. */
export async function broadcast(tx: Uint8Array): Promise<boolean> {
  log("  broadcasting…")
  try {
    const { ended, detail } = await submitAndWatch(NETWORK.peopleWs, hex(tx), (status) => {
      if (typeof status === "string") log(`    ${status}`)
    })
    if (ended === "inBlock" || ended === "finalized") {
      ok(`broadcast: in block ${show(detail)}`)
      return true
    }
    bad(`broadcast: ${ended}`, detail)
    return false
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error)
    bad(runtimePanicked(text) ? "broadcast: the node's pool could not decode it (runtime wasm trap)" : "broadcast: refused by the node", text.slice(0, 200))
    return false
  }
}
