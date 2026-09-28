/**
 * SCRIPT 3 — the workaround the game product ships (jollity-next#141)
 * =============================================================================
 *
 * Send 0 like the stock signer. When the host answers with a signed v4 and the
 * pipeline declares a `VerifyMultiSignature` we did not send, insert that slot
 * as `Disabled` at its pipeline position and have the host sign once more.
 * Two host signatures for one action, a metadata decode in the product, and a
 * condition that must never fire on a #1003 host — the elaborate part we would
 * like to delete.
 *
 * Run:  scripts/run.sh scripts/3-workaround.ts        (SUBMIT=1 to broadcast)
 */
import { examine } from "../lib/examine"
import { fixedUpSigner } from "../lib/signers"
import { log } from "../lib/report"

export {}
declare const truapi: import("@parity/truapi").TrUApiClient

const passed = await examine(truapi, "SCRIPT 3 — the workaround: v4 re-signed with VerifyMultiSignature filled in", (x) =>
  fixedUpSigner(x.truApi, x.account, x.stock, (filled) =>
    log(`    the host built a v4 without the slot — signing again with: ${filled.map((e) => `${e.id}${e.id === "VerifyMultiSignature" ? `=${e.extra}` : ""}`).join(", ")}`),
  ),
)
log(passed ? "\nSCRIPT_3_OK — the re-signed v4 is sound\n" : "\nSCRIPT_3_FAILED\n")
if (!passed) throw new Error("the transaction is not sound on this host") // a throw is the runner's non-zero exit
