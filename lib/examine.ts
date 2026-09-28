/**
 * The one routine every script runs: build a harmless call on the typed api
 * (`System.remark_with_event`), have the given signer produce the transaction
 * through the host, then report what came back — the format byte, the
 * extension bytes walked against the runtime pipeline, the runtime's
 * `validate_transaction` verdict, and with `SUBMIT=1` a broadcast (the account
 * pays the fee, so it needs funds). Both verdicts go straight to the node.
 */
import { Binary } from "polkadot-api"
import type { PolkadotSigner } from "polkadot-api/signer"
import type { TrUApiClient } from "@parity/truapi"
import { AccountId } from "polkadot-api"
import { connectPeople, NETWORK } from "./chain"
import { walkExtensions, formatOf } from "./decode"
import { bridgeToHost } from "./host-connect"
import { fail, hex, log, ok } from "./report"
import { broadcast, runtimeVerdict } from "./verdict"
import type { AccountsProvider, ProductAccount, TruApi } from "@parity/product-sdk-host"

export interface Examination {
  accounts: AccountsProvider
  truApi: TruApi
  account: ProductAccount
  /** the SDK's stock signer for the account — what every product uses */
  stock: PolkadotSigner
}

/** Runs `pick` to choose the signer, signs, and reports. Returns whether every verdict passed. */
export async function examine(truapi: TrUApiClient, label: string, pick: (x: Examination) => PolkadotSigner): Promise<boolean> {
  log(`${label} — ${NETWORK.gameProductId} on ${NETWORK.name}\n`)
  const { accounts, truApi } = await bridgeToHost(truapi)
  const account = await accounts.getProductAccount(NETWORK.gameProductId).match(
    (a) => a,
    (e) => fail("getProductAccount", e),
  )
  ok("signing account", `${account.dotNsIdentifier}#${account.derivationIndex} = ${AccountId().dec(account.publicKey)}`)

  const conn = connectPeople()
  try {
    // the metadata papi hands the signer is what the walk decodes against
    let metadata: Uint8Array | undefined
    let forwarded = { ids: [] as string[], extra: new Uint8Array() }
    const chosen = pick({ accounts, truApi, account, stock: accounts.getProductAccountSigner(account) })
    const signer: PolkadotSigner = {
      ...chosen,
      signTx: (callData, signedExtensions, meta, ...rest) => {
        metadata = meta
        const values = Object.values(signedExtensions)
        forwarded = { ids: values.map((e) => e.identifier), extra: Uint8Array.from(values.flatMap((e) => [...e.value])) }
        return chosen.signTx(callData, signedExtensions, meta, ...rest)
      },
    }
    const call = conn.api.tx.System.remark_with_event({ remark: Binary.fromText("tx-ext-version-repro") })
    const callData = await call.getEncodedData()
    const tx = await call.sign(signer)
    const format = formatOf(tx)
    ok(`the host returned ${tx.length} bytes`, hex(tx))
    log(`    extrinsic v${format.version} ${format.kind}`)
    for (const line of walkExtensions(metadata!, tx, forwarded, callData)) log(`    ${line}`)

    const runtimeOk = await runtimeVerdict(tx)
    if (process.env.SUBMIT !== "1") return runtimeOk
    if (!runtimeOk) {
      log("  SUBMIT=1, but the runtime already refused it — not broadcasting")
      return false
    }
    return broadcast(tx)
  } finally {
    conn.client.destroy()
  }
}
