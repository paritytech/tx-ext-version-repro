/**
 * The one boilerplate every script shares: log in with the runner's raw
 * `@parity/truapi` client, then BRIDGE it into product-sdk so the SDK's signer
 * drives this same host. `setTruApiClient` is product-sdk-host's testing seam;
 * the SDK otherwise only connects when it detects a webview, and a
 * `truapi-host --script` run is not one.
 */
import { setTruApiClient } from "@parity/product-sdk-host/testing"
import { getAccountsProvider, getTruApi } from "@parity/product-sdk-host"
import type { AccountsProvider, TruApi } from "@parity/product-sdk-host"
import type { TrUApiClient } from "@parity/truapi"
import { fail, ok } from "./report"

export async function bridgeToHost(truapi: TrUApiClient): Promise<{ accounts: AccountsProvider; truApi: TruApi }> {
  const login = await truapi.account.requestLogin({ reason: undefined })
  if (!login.isOk() || (login.value !== "Success" && login.value !== "AlreadyConnected"))
    fail("requestLogin", login.isOk() ? login.value : login.error)
  setTruApiClient(truapi)
  const accounts = await getAccountsProvider()
  const truApi = await getTruApi()
  if (!accounts || !truApi) fail("connect", "product-sdk did not connect to the host")
  ok("bridged product-sdk onto the host")
  return { accounts, truApi }
}
