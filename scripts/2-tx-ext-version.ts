/**
 * SCRIPT 2 — the same forwarding, with `txExtVersion` made explicit
 * =============================================================================
 *
 * `TX_EXT_VERSION=0` reproduces script 1 (a v4 one slot short).
 * `TX_EXT_VERSION=5` makes a pre-#1003 host build a v5 general transaction and
 * fill the `VerifyMultiSignature` slot itself: complete, valid — and the value
 * the Android host refuses ("Transaction extension version 5 is not supported
 * by runtime", paritytech/platform-bugs#42), and that host-rust-core#1003
 * makes every host refuse. So neither value works everywhere today.
 *
 * Run:  TX_EXT_VERSION=0 scripts/run.sh scripts/2-tx-ext-version.ts
 *       TX_EXT_VERSION=5 scripts/run.sh scripts/2-tx-ext-version.ts
 */
import { examine } from "../lib/examine"
import { hostSigner } from "../lib/signers"
import { log } from "../lib/report"

export {}
declare const truapi: import("@parity/truapi").TrUApiClient

const version = Number(process.env.TX_EXT_VERSION ?? "0")
const passed = await examine(truapi, `SCRIPT 2 — txExtVersion ${version}`, (x) => hostSigner(x.truApi, x.account, x.stock, version))
log(passed ? `\nSCRIPT_2_OK — txExtVersion ${version} yields a sound transaction on this host\n` : `\nSCRIPT_2_FAILED — txExtVersion ${version} does not yield a sound transaction on this host\n`)
if (!passed) throw new Error("the transaction is not sound on this host") // a throw is the runner's non-zero exit
