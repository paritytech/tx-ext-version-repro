/**
 * SCRIPT 1 — what every product does today: the SDK's stock signer
 * =============================================================================
 *
 * `accounts.getProductAccountSigner(account)` forwards the extensions papi
 * prepared and sends `txExtVersion: 0`. On a host that reads 0 as "extrinsic
 * v4" (every released core so far), the answer is a signed v4 whose extension
 * bytes lack the `VerifyMultiSignature` slot the People runtime's pipeline
 * declares: papi never forwards that slot (it has no value to encode for it),
 * and the host's v4 path concatenates only what it was sent. The walk below
 * shows the bytes going off the rails one slot after the missing one, papi's
 * submit fails before broadcast, and the runtime refuses to validate it.
 *
 * Run:  scripts/run.sh scripts/1-stock-signer.ts        (SESSION=<name>)
 */
import { examine } from "../lib/examine"
import { log } from "../lib/report"

export {}
declare const truapi: import("@parity/truapi").TrUApiClient

const passed = await examine(truapi, "SCRIPT 1 — the SDK's stock signer (txExtVersion 0 as the SDK sends it)", (x) => x.stock)
log(passed ? "\nSCRIPT_1_OK — the stock signer's transaction is sound on this host\n" : "\nSCRIPT_1_FAILED — the stock signer's transaction does not decode against the runtime pipeline\n")
if (!passed) throw new Error("the transaction is not sound on this host") // a throw is the runner's non-zero exit
