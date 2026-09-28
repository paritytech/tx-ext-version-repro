/**
 * Three ways to have the host build and sign a papi-prepared transaction.
 *
 * 1. `accounts.getProductAccountSigner(account)` — the SDK's STOCK signer, what
 *    every product does. It forwards the extensions papi prepared and sends
 *    `txExtVersion: 0` (product-sdk-host 0.23, `deriveTxExtVersion`). Not in
 *    this file: it comes from the SDK.
 *
 * 2. `hostSigner(…, txExtVersion)` — the same forwarding, with the value made
 *    explicit, so the scripts can compare what the host does with 0 and 5.
 *
 * 3. `fixedUpSigner(…)` — the WORKAROUND the game product ships
 *    (paritytech/jollity-next#141): when 0 comes back as a signed v4 and the
 *    runtime pipeline declares a `VerifyMultiSignature` the caller did not
 *    send, insert that slot as `Disabled` at its pipeline position and have the
 *    host sign again. Never up front: a host with host-rust-core#1003 answers
 *    0 with a v5 and would assemble an UNSIGNED v5 if the slot were supplied.
 */
import type { PolkadotSigner } from "polkadot-api/signer"
import type { ProductAccount, TruApi } from "@parity/product-sdk-host"
import { pipelineOf } from "./decode"
import { hex } from "./report"

const fromHex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"))

export interface ForwardedExtension {
  id: string
  extra: `0x${string}`
  additionalSigned: `0x${string}`
}

const VERIFY_MULTI_SIGNATURE = "VerifyMultiSignature"

/** Ask the host for the transaction: every extension papi prepared, forwarded as is. */
export async function buildOnHost(
  truApi: TruApi,
  account: ProductAccount,
  genesisHash: `0x${string}`,
  callData: Uint8Array,
  extensions: ForwardedExtension[],
  txExtVersion: number,
): Promise<Uint8Array> {
  const built = await truApi.signing.createTransaction({
    signer: {
      dotNsIdentifier: account.dotNsIdentifier,
      derivationIndex: { tag: "Index", value: account.derivationIndex },
    },
    genesisHash,
    callData: hex(callData),
    extensions,
    txExtVersion,
  })
  return built.match(
    (response) => fromHex(response.transaction),
    (cause) => {
      throw new Error(`the host could not build the transaction (txExtVersion ${txExtVersion}): ${JSON.stringify(cause)}`)
    },
  )
}

export const forward = (signedExtensions: Parameters<PolkadotSigner["signTx"]>[1]): ForwardedExtension[] =>
  Object.values(signedExtensions).map((extension) => ({
    id: extension.identifier,
    extra: hex(extension.value),
    additionalSigned: hex(extension.additionalSigned),
  }))

const genesisOf = (signedExtensions: Parameters<PolkadotSigner["signTx"]>[1]): `0x${string}` => {
  const genesis = signedExtensions["CheckGenesis"]
  if (!genesis) throw new Error("the transaction carries no CheckGenesis")
  return hex(genesis.additionalSigned)
}

/** 2 — the stock signer's forwarding with `txExtVersion` made explicit. */
export function hostSigner(truApi: TruApi, account: ProductAccount, inner: PolkadotSigner, txExtVersion: number): PolkadotSigner {
  return {
    publicKey: inner.publicKey,
    signBytes: (data) => inner.signBytes(data),
    signTx: (callData, signedExtensions) =>
      buildOnHost(truApi, account, genesisOf(signedExtensions), callData, forward(signedExtensions), txExtVersion),
  }
}

/** Whether the host answered with a signed extrinsic v4 (`0x84` behind the compact length). */
export function isSignedV4(transaction: Uint8Array): boolean {
  const first = transaction[0]
  if (first === undefined) return false
  const mode = first & 0b11
  const lengthBytes = mode === 0 ? 1 : mode === 1 ? 2 : mode === 2 ? 4 : 5 + (first >> 2)
  return transaction[lengthBytes] === 0x84
}

/** 3 — the workaround: fill the slot the v4 path leaves out, then sign again. */
export function fixedUpSigner(
  truApi: TruApi,
  account: ProductAccount,
  inner: PolkadotSigner,
  onFilled?: (extensions: ForwardedExtension[]) => void,
): PolkadotSigner {
  return {
    publicKey: inner.publicKey,
    signBytes: (data) => inner.signBytes(data),
    async signTx(callData, signedExtensions, metadata) {
      const genesis = genesisOf(signedExtensions)
      const forwarded = forward(signedExtensions)
      const transaction = await buildOnHost(truApi, account, genesis, callData, forwarded, 0)
      if (!isSignedV4(transaction) || forwarded.some((e) => e.id === VERIFY_MULTI_SIGNATURE)) return transaction
      const pipeline = pipelineOf(metadata)
      if (pipeline.disabledSignature === undefined) return transaction
      const rank = new Map(pipeline.order.map((id, i) => [id, i]))
      const filled = [
        ...forwarded,
        { id: VERIFY_MULTI_SIGNATURE, extra: hex(pipeline.disabledSignature), additionalSigned: "0x" as const },
      ].sort((a, b) => (rank.get(a.id) ?? pipeline.order.length) - (rank.get(b.id) ?? pipeline.order.length))
      onFilled?.(filled)
      return buildOnHost(truApi, account, genesis, callData, filled, 0)
    },
  }
}
