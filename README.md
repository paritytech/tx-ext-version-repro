# tx-ext-version-repro — one extension slot short

A minimal, runnable reproduction of why **no account-signed transaction from a
product goes through on today's phone hosts**, and of the workaround the game
product (dim2) ships meanwhile — built so the platform side can see the bytes,
fix it at the right level, and we can delete the workaround.

Scripts run the way host-rust-core runs its own e2e: `truapi-host signing-host
--script <file>`, as the game product `dim2.<tld>`, against previewnet by
default. One product account signs a harmless `System.remark_with_event`; each
script prints the transaction the host built, walks its extension bytes against
the runtime's pipeline, and asks the node for two verdicts: the runtime's
`TaggedTransactionQueue_validate_transaction`, and (with `SUBMIT=1`) an actual
broadcast.

## The symptom

On 2026-09-28 both phones (iOS and Android, host-rust-core nightlies of 09-26,
a 0.21-line core) had the game's one-tap sign-up die right after the host
signed, with the minified `i is not a function` (`innerDecoder is not a
function` unminified — a scale-ts enum decoder meeting a variant byte it does
not know). Logs from both phones decoded to the same thing: the host returned
a **signed extrinsic v4** whose extension bytes were **one slot short** of the
People runtime's transaction-extension pipeline.

## The mechanism

1. The People runtime's pipeline (v16 metadata, `signedExtensions[0]`) starts
   `UnitTransactionExtension, VerifyMultiSignature, AsPerson, …` and ends with
   the usual `CheckMortality, CheckNonce, …, ChargeAssetTxPayment`.
2. papi's `getSignExtensionsCreator` builds the extension record the signer
   gets. For `VerifyMultiSignature` it has no value to encode, so it **drops
   the key**. product-sdk's origin wrappers (`withLiteAlias`, `withAsPerson`,
   `withScoreParticipant`) add that slot only for an *unsigned* call.
3. product-sdk-host's stock `getProductAccountSigner` forwards that record to
   `truApi.signing.createTransaction` with `txExtVersion: 0`.
4. Every released host core reads `0` as "extrinsic v4" and assembles the v4
   from the extension bytes it was sent, **and nothing else**
   (`host_logic/extrinsic.rs`, `build_signed_extrinsic_v4`: "metadata-free").
   Its **v5 path fills `VerifyMultiSignature` itself**; its v4 path does not.
5. So the v4 comes back with `AsPerson`'s byte sitting where
   `VerifyMultiSignature` should be, every later slot shifted by one. papi's
   submit path decodes the mortality out of the signed bytes first and trips;
   had it not, the runtime would have refused the bytes.

Why not send `5`, which makes those hosts build a complete v5? Because the
Android host reads the field as the *transaction extension* version and
refuses `5` ("Transaction extension version 5 is not supported by runtime",
platform-bugs#42) — and host-rust-core#1003, which settles the field's meaning,
makes every host refuse it. So `0` is the only value with a future, and what
`0` yields today is a broken v4.

## The scripts

| # | Script | What it does | Result on a pre-#1003 host (truapi-host 0.21.0, previewnet, 2026-09-28) — for main see [Status](#status-on-host-rust-core-main-2026-09-29) |
|---|---|---|---|
| 1 | `1-stock-signer` | the SDK's stock signer, exactly what every product does | **fails** — v4, `VerifyMultiSignature` absent, every later slot shifted, call data one byte short; the runtime **panics** in `validate_transaction` (wasm trap) |
| 2 | `2-tx-ext-version` with `TX_EXT_VERSION=0` | the same forwarding, value explicit | **fails** — identical bytes and verdict |
| 2 | `2-tx-ext-version` with `TX_EXT_VERSION=5` | ask for v5 (what dim2 sent until #135; what Android refuses) | **sound** — v5 general, slot filled by the host (`Signed`), valid, **in block** |
| 3 | `3-workaround` | dim2's workaround: re-sign the v4 with the slot filled in | **sound** — v4 with the slot as `Disabled`, valid, **in block**; two host signatures for one action |

Each run's full output is what the platform team should read: the bytes, the
slot-by-slot walk, and the verdicts. Excerpts are in [Run it](#run-it).

## Status (2026-09-29, 14:30 UTC): fixed and released on the host side, the SDK release is the gate

+ fix(server): read txExtVersion as the transaction extension version — **merged 2026-09-29 12:19 UTC, released in `@parity/truapi-host` / `@parity/truapi` 0.23.0 (14:03 UTC) and the `ios-host` / `android-host` 0.23.0 line**
  → https://github.com/paritytech/host-rust-core/pull/1003
+ fix(signing): make transaction extension version configurable — **merged 2026-09-29**, the SDK's half: `txExtVersion` is the extension version, default `0`
  → https://github.com/paritytech/product-sdk/pull/415

Re-run against a `truapi-host` built from main (`33b33616c`): **the version
bug is fixed.** `0` yields a v5 general transaction with `VerifyMultiSignature`
filled by the host; scripts 1, 2 (`0`) and 3 pass, and the workaround's
fix-up never fires (the first answer is already a v5). `5` is now refused
(`NotSupported: unsupported tx_ext_version 5; the runtime declares transaction
extension versions [0]`), as expected.

| # | Script | pre-#1003 host (0.21.0) | host from main (#1003) |
|---|---|---|---|
| 1 | stock signer, `0` | fails, runtime panics | **sound**, v5, in block |
| 2 | `TX_EXT_VERSION=0` | fails | **sound**, v5, in block |
| 2 | `TX_EXT_VERSION=5` | sound (v5) | **refused**, `NotSupported` |
| 3 | workaround | sound, two signatures | **sound**, fix-up does not fire |

**Shipped on the host side; a second gap keeps products off it.** The 0.22.0
releases (2026-09-28) and the 09-28 nightlies (`ca44c7f`) predate the merge;
the 0.23.0 releases (2026-09-29 14:03 UTC) and every nightly from 2026-09-29
on carry it.

But **every host from 0.22.0 on carries a signing-request change the released
SDK does not know**: the payload gained `contacts` (host-rust-core#17,
`a2855236c`) without a wire-codec bump (still 3). product-sdk-host 0.23.0 is
built on truapi 0.20 and sends no such field; a host on 0.22.0 or newer refuses
its request (`MalformedFrame` on the phone; in this runner the host's own
client fails to encode it). So on those hosts **no product on the released SDK
can sign at all**, version fix or not. The way through is one product-sdk
release on truapi 0.23 and every product bumping to it:

+ chore(release): bump @parity/truapi to 0.23.0 — open (release bot; the 0.22.0 one before it failed CI on the host package's test client lacking the new `contacts` surface)
  → https://github.com/paritytech/product-sdk/pull/419

`CONTACTS_SHIM=1` fills `contacts: []` in this runner so the version fix can be
measured on such a host; it is not a fix, it stands in for that SDK release.

For dim2 that means: keep the workaround until the phones run a 0.23.0-line
build **and** the app is on an SDK that sends `contacts`. The removal is
prepared and waits on that SDK release:

+ Drop the v4 signature-slot workaround and the desk's lite-key register step once product-sdk releases on truapi 0.23
  → https://github.com/paritytech/jollity-next/issues/151
+ Use the SDK's stock signer now that truapi-host 0.23.0 builds the whole transaction — draft
  → https://github.com/paritytech/jollity-next/pull/152

### What the main host prints

```text
$ CONTACTS_SHIM=1 npm run 1:stock-signer      # truapi-host built from main at 33b33616c (2026-09-29), previewnet, SUBMIT=1
SCRIPT 1 — the SDK's stock signer (txExtVersion 0 as the SDK sends it) — dim2.testnet on previewnet
  CONTACTS_SHIM=1: filling the `contacts` field the released SDK does not send
OK  bridged product-sdk onto the host
OK  signing account: "dim2.testnet#0 = 5G9MfH8gRsVkwPdE21kViTQaSRCsdh1Dm4my52tUydeo3irK"
OK  the host returned 140 bytes: "0x290245000101065c23c24732135c40af6ef3ce0fc5ed506743ec7a323b35017ea7aa604e590b13bc6643822ecc1977b37ac78222b79164b76402fb567e43511b4
    extrinsic v5 general
    format: extrinsic v5 general; extensions start at byte 4
    the host's extension region (113 bytes) holds 98 byte(s) more than the caller's first request forwarded (15): a VerifyMultiSignature slot is present
      UnitTransactionExtension (empty)                  undefined
      VerifyMultiSignature     0x0101065c23c24732135c40af6ef3ce0fc5ed506743ec7a323b35017ea7aa604e590b13bc6643822ecc1977b37ac78222b79164b76402fb567e43511b4e9f27ea2b8d
      AsPerson                 0x00                     undefined
      AsProofOfInkParticipant  0x00                     undefined
      ScoreAsParticipant       0x00                     undefined
      GameAsInvited            0x00                     undefined
      PeopleLiteAuth           0x00                     undefined
      AsMember                 0x00                     undefined
      AsCoinage                0x00                     undefined
      AsResources              0x00                     undefined
      HonourAuth               0x00                     undefined
      AuthorizeCall            (empty)                  undefined
      RestrictOrigins          0x00                     false
      CheckNonZeroSender       (empty)                  undefined
      CheckSpecVersion         (empty)                  undefined
      CheckTxVersion           (empty)                  undefined
      CheckGenesis             (empty)                  undefined
      CheckMortality           0xd501                   {"type":"Mortal213","value":1}
      CheckNonce               0x1c                     7
      CheckWeight              (empty)                  undefined
      ChargeAssetTxPayment     0x0000                   {"tip":"0"}
      StorageWeightReclaim     (empty)                  undefined
      call data: 0x00075074782d6578742d76657273696f6e2d726570726f
OK  runtime validate_transaction: VALID
  broadcasting…
    ready
OK  broadcast: in block "0xe8240c3a75b9da6fa2f6f5d41be6ed8d372df288b2f7e44a1a17d946927fb2e9"

$ CONTACTS_SHIM=1 TX_EXT_VERSION=5 npm run 2:tx-ext-version
SCRIPT 2 — txExtVersion 5 — dim2.testnet on previewnet
[script error] Error: the host could not build the transaction (txExtVersion 5): {"tag":"Domain","value":{"tag":"V1","value":{"tag":"NotSupported","value":{"reason":"unsupported tx_ext_version 5; the runtime declares transaction extension versions [0]"}}}}

$ npm run 1:stock-signer                        # same host, WITHOUT the shim: the released SDK cannot even send the request
[script error] TypeError: undefined is not an object (evaluating 'value.length')
    at …/node_modules/scale-ts/dist/scale-ts.mjs:342:123
    at …/js/packages/truapi/src/generated/client.ts:1214:54 (createTransaction)
    at signTx (…/@parity/product-sdk-host/dist/index.js:974:21)
```

## What needs to work, and at which level

**Host (host-rust-core) — this is where the fix belongs, and it is fixed and released (see above).** A product that sends
`txExtVersion: 0` — the only value the SDK sends and the only one Android
accepts — must get back a transaction the runtime decodes. PR #1003 does that:
it reads the field as the transaction-extension version, builds a v5 general
transaction whenever pipeline 0 declares `VerifyMultiSignature` (filling that
slot host-side, as the v5 path already does), and a v4 only for a pipeline
without it. That behaviour is in truapi-host 0.23.0 and the 0.23.0 phone line.

- + fix(server): read txExtVersion as the transaction extension version — **merged, released in 0.23.0**
  → https://github.com/paritytech/host-rust-core/pull/1003
- + Android: `createTransaction` with `txExtVersion: 5` fails with "Failed to load transaction" — the reason `5` is not a way out
  → https://github.com/paritytech/platform-bugs/issues/42

**product-sdk — one release on truapi 0.23.** The stock signer's `0` is the
correct value under #1003's semantics, and #415 (merged) makes the SDK read the
field the same way. What products need is a published `@parity/product-sdk-host`
built on truapi 0.23, so its signing request carries `contacts` (PR 419 above).
The older issue predates that understanding, and the pin we proposed was the
wrong shape and is closed:

- + fix(signing): make transaction extension version configurable — merged 2026-09-29
  → https://github.com/paritytech/product-sdk/pull/415
- + product-sdk: `create_transaction` fills `txExtVersion` incorrectly — open, superseded by #1003's reading of the field
  → https://github.com/paritytech/product-sdk/issues/339
- + feat(host,signer): let a product-account signer pin the extrinsic format — closed, wrong shape
  → https://github.com/paritytech/product-sdk/pull/408

**The product (jollity-next) — what we carry and want to delete.** Everything
below exists only because of the above and goes the day the phones run a
#1003 host:

- `lib/host/general-tx-signer.ts` — the whole file. It wraps the stock signer to
  forward the extensions with an explicit `txExtVersion` and, since #141, to
  detect a v4 that lacks the slot, insert `VerifyMultiSignature: Disabled` at
  its pipeline position (decoding the metadata in the product to find it) and
  have the host sign a second time. Two signatures for one tap, and a fix-up
  that must never fire on a #1003 host (it would produce an unsigned v5).
  + Fill the VerifyMultiSignature slot a v4-building host leaves out, so phones can sign — merged, live on dim2.paseo as 0.1.7
    → https://github.com/paritytech/jollity-next/pull/141
  + fix: android transaction not loading — the switch from `5` to `0`
    → https://github.com/paritytech/jollity-next/pull/135
- `scripts/dev-host.mjs` sends the desk CLI `5` (its v4 path is the broken one,
  and the CLI accepts `5`); that default must flip to `0` when the CLI moves to
  a #1003 core, or every desk write breaks.
- humanity-spa carries the same forced-`5` wrapper
  (`packages/shared/src/chain/v5-product-account-signer.ts`) and breaks the
  same day `5` is refused.

The sign-up flow this all serves, for context:
+ Sign a lite person up in one tap: bind in the background, free by default, prize draws entered
  → https://github.com/paritytech/jollity-next/pull/140
+ Build the lite bind with the SDK's buildLiteAliasBindTx
  → https://github.com/paritytech/jollity-next/pull/130

Two more desk-only workarounds in jollity-next ride the same "host not released
yet" wave and are listed so they get deleted together, not because they are
about `txExtVersion`:
- `scripts/lite-key.mts --as peopl --register` registers the lite ring key the
  CLI attests at onboarding but never records; obsolete once the previewnet
  genesis re-pin ships (merged).
  + listRingVrfKeys returns an empty list for a key registerRingVrfKey just returned
    → https://github.com/paritytech/host-rust-core/issues/657
  + fix(host-cli): follow previewnet through its latest reset — merged
    → https://github.com/paritytech/host-rust-core/pull/995

## Run it

```sh
npm install

# a host from before #1003 reproduces the failure, e.g. the 0.21.0 CLI (the current release, 0.23.0, has the fix):
#   curl -fsSL https://raw.githubusercontent.com/paritytech/host-rust-core/main/scripts/truapi-host-installer.sh | TRUAPI_HOST_VERSION=0.21.0 bash
# TRUAPI_HOST=<path> picks another binary (0.23.0 makes 1 and 3 pass without the fix-up firing — with CONTACTS_SHIM=1 until the SDK release)

npm run 1:stock-signer                          # what every product does: FAILS
TX_EXT_VERSION=0 npm run 2:tx-ext-version       # same thing, explicit: FAILS
TX_EXT_VERSION=5 npm run 2:tx-ext-version       # v5: sound here, refused on Android and after #1003
npm run 3:workaround                            # dim2's fix-up: sound, at the cost described above

# CONTACTS_SHIM=1 on a host from 0.22.0 / main (its signing request wants a `contacts` field the released SDK lacks)
# NETWORK=paseo-next-v2 for the paseo chain; SESSION=<name> picks the person
# (a fresh name onboards one first, ~1 min, prints nothing meanwhile);
# SUBMIT=1 also broadcasts — the dim2 account then needs funds for the fee.
```

`.state/` holds the onboarded person's signing keys and is git-ignored.

### What a run prints

```text
$ npm run 1:stock-signer            # truapi-host 0.21.0, previewnet, SUBMIT=1
SCRIPT 1 — the SDK's stock signer (txExtVersion 0 as the SDK sends it) — dim2.testnet on previewnet
OK  bridged product-sdk onto the host
OK  signing account: "dim2.testnet#0 = 5G9MfH8gRsVkwPdE21kViTQaSRCsdh1Dm4my52tUydeo3irK"
OK  the host returned 139 bytes: "0x25028400b47d2c7c5e7d0298de47ad5bb27ff4fa0b550d48c02ea9d726a67c13648f4a6701781bc3452dfd621154c2d723fc93dd3f1577bd6265b659357f74292
    extrinsic v4 signed
    format: extrinsic v4 signed; extensions start at byte 101
    pipeline (22 slots): UnitTransactionExtension, VerifyMultiSignature, AsPerson, AsProofOfInkParticipant, ScoreAsParticipant, GameAsInvited, PeopleLiteAuth, AsMemb
    forwarded by the caller: 21 of them; NOT forwarded: VerifyMultiSignature
    the host's extension region (15 bytes) is the 21 forwarded values VERBATIM, then the call — nothing added for VerifyMultiSignature
      UnitTransactionExtension (empty)                  undefined
      VerifyMultiSignature     0x00                     {"type":"Disabled"}
      AsPerson                 0x00                     undefined
      AsProofOfInkParticipant  0x00                     undefined
      ScoreAsParticipant       0x00                     undefined
      GameAsInvited            0x00                     undefined
      PeopleLiteAuth           0x00                     undefined
      AsMember                 0x00                     undefined
      AsCoinage                0x00                     undefined
      AsResources              0x00                     undefined
      HonourAuth               0x00                     undefined
      AuthorizeCall            (empty)                  undefined
      RestrictOrigins          0xa5                     true
      CheckNonZeroSender       (empty)                  undefined
      CheckSpecVersion         (empty)                  undefined
      CheckTxVersion           (empty)                  undefined
      CheckGenesis             (empty)                  undefined
      CheckMortality           0x0110                   {"type":"Mortal1","value":16}
      CheckNonce               0x00                     0
      CheckWeight              (empty)                  undefined
      ChargeAssetTxPayment     0x0000                   {"tip":"0"}
      StorageWeightReclaim     (empty)                  undefined
      call data: 0x075074782d6578742d76657273696f6e2d726570726f
BAD runtime validate_transaction: the runtime PANICS decoding the transaction (wasm trap)
  SUBMIT=1, but the runtime already refused it — not broadcasting

$ npm run 3:workaround
SCRIPT 3 — the workaround: v4 re-signed with VerifyMultiSignature filled in — dim2.testnet on previewnet
OK  bridged product-sdk onto the host
OK  signing account: "dim2.testnet#0 = 5G9MfH8gRsVkwPdE21kViTQaSRCsdh1Dm4my52tUydeo3irK"
    the host built a v4 without the slot — signing again with: UnitTransactionExtension, VerifyMultiSignature=0x00, AsPerson, AsProofOfInkParticipant, ScoreAsPartici
OK  the host returned 140 bytes: "0x29028400b47d2c7c5e7d0298de47ad5bb27ff4fa0b550d48c02ea9d726a67c13648f4a6701988388c7334d22231f6f5b95e780e68b99db55733dd8ad36662d840
    extrinsic v4 signed
    format: extrinsic v4 signed; extensions start at byte 101
    the host's extension region (16 bytes) holds 1 byte(s) more than the caller's first request forwarded (15): a VerifyMultiSignature slot is present
      UnitTransactionExtension (empty)                  undefined
      VerifyMultiSignature     0x00                     {"type":"Disabled"}
      AsPerson                 0x00                     undefined
      AsProofOfInkParticipant  0x00                     undefined
      ScoreAsParticipant       0x00                     undefined
      GameAsInvited            0x00                     undefined
      PeopleLiteAuth           0x00                     undefined
      AsMember                 0x00                     undefined
      AsCoinage                0x00                     undefined
      AsResources              0x00                     undefined
      HonourAuth               0x00                     undefined
      AuthorizeCall            (empty)                  undefined
      RestrictOrigins          0x00                     false
      CheckNonZeroSender       (empty)                  undefined
      CheckSpecVersion         (empty)                  undefined
      CheckTxVersion           (empty)                  undefined
      CheckGenesis             (empty)                  undefined
      CheckMortality           0x1502                   {"type":"Mortal21","value":2}
      CheckNonce               0x14                     5
      CheckWeight              (empty)                  undefined
      ChargeAssetTxPayment     0x0000                   {"tip":"0"}
      StorageWeightReclaim     (empty)                  undefined
      call data: 0x00075074782d6578742d76657273696f6e2d726570726f
OK  runtime validate_transaction: VALID
  broadcasting…
    ready
OK  broadcast: in block "0xff43bb0b83f93c6693d633e650c481f6169f3beae5177130ff8aa64c7b08b362"
```

## How it's built

`lib/examine.ts` is the whole routine: bridge product-sdk onto the runner's
`truapi` client (`setTruApiClient`, the SDK's testing seam), read the product
account, build the remark on the typed api, sign through the chosen signer,
then report. `lib/decode.ts` walks the extension bytes slot by slot against
`unifyMetadata(decAnyMetadata(metadata))` with papi's dynamic builder — the
same metadata papi hands the signer. `lib/signers.ts` holds the explicit-version
forwarding and the workaround, ported from jollity-next. `lib/verdict.ts` asks the node,
over a raw socket, to validate and (optionally) include it.

Dependencies are on the latest releases (`product-sdk-host` 0.23.0,
`-individuality` 0.6.0, `-descriptors` 0.12.0); `polkadot-api` stays on the
2.x line the SDK is built against, and `@parity/truapi` matches the SDK's own
copy since the types must agree on the client handed to the bridge.
