/**
 * The one boilerplate every script shares: log in with the runner's raw
 * `@parity/truapi` client, then BRIDGE it into product-sdk so the SDK's signer
 * drives this same host. `setTruApiClient` is product-sdk-host's testing seam;
 * the SDK otherwise only connects when it detects a webview, and a
 * `truapi-host --script` run is not one.
 *
 * THE SECOND GAP. From host-rust-core 0.22.0 (and main) the signing request
 * carries a `contacts` field (host-rust-core#17) that the released SDK
 * (product-sdk-host 0.23.0, built on truapi 0.20) does not send, and the wire
 * codec version did not move. The host's own client then fails to encode the
 * request before it leaves the product ("undefined is not an object
 * (evaluating 'value.length')" in scale-ts); a phone, whose SDK bundles the
 * older client, sends the old frame and the host refuses it as MalformedFrame.
 * `CONTACTS_SHIM=1` fills the field with `[]` so the version question can be
 * measured on such a host; without it, the scripts fail there before signing.
 */
import { setTruApiClient } from "@parity/product-sdk-host/testing"
import { getAccountsProvider, getTruApi } from "@parity/product-sdk-host"
import type { AccountsProvider, TruApi } from "@parity/product-sdk-host"
import type { TrUApiClient } from "@parity/truapi"
import { fail, log, ok } from "./report"

function withContactsShim(truapi: TrUApiClient): TrUApiClient {
  const signing = Object.create(truapi.signing) as TrUApiClient["signing"]
  signing.createTransaction = (payload) =>
    truapi.signing.createTransaction({ contacts: [], ...payload } as typeof payload)
  const client = Object.create(truapi) as TrUApiClient
  Object.defineProperty(client, "signing", { value: signing })
  return client
}

export async function bridgeToHost(truapi: TrUApiClient): Promise<{ accounts: AccountsProvider; truApi: TruApi }> {
  const login = await truapi.account.requestLogin({ reason: undefined })
  if (!login.isOk() || (login.value !== "Success" && login.value !== "AlreadyConnected"))
    fail("requestLogin", login.isOk() ? login.value : login.error)
  if (process.env.CONTACTS_SHIM === "1") {
    log("  CONTACTS_SHIM=1: filling the `contacts` field the released SDK does not send")
    setTruApiClient(withContactsShim(truapi))
  } else setTruApiClient(truapi)
  const accounts = await getAccountsProvider()
  const truApi = await getTruApi()
  if (!accounts || !truApi) fail("connect", "product-sdk did not connect to the host")
  ok("bridged product-sdk onto the host")
  return { accounts, truApi }
}
