/**
 * The People / individuality chain we read from and validate against, and a
 * typed papi client for it. We open our OWN WebSocket for reads; the host signs.
 * Default PREVIEWNET, or `NETWORK=paseo-next-v2` (scripts/run.sh forwards the
 * same choice to the host).
 */
import { createClient } from "polkadot-api"
import { getWsProvider } from "polkadot-api/ws"
import { previewnet_individuality } from "@parity/product-sdk-descriptors/previewnet-individuality"
import { paseo_individuality } from "@parity/product-sdk-descriptors/paseo-individuality"

const NETWORKS = {
  previewnet: {
    name: "previewnet",
    peopleWs: "wss://previewnet.substrate.dev/people",
    tld: "testnet",
    gameProductId: "dim2.testnet",
    descriptor: previewnet_individuality,
  },
  "paseo-next-v2": {
    name: "paseo-next-v2",
    peopleWs: "wss://paseo-people-next-system-rpc.polkadot.io",
    tld: "paseo",
    gameProductId: "dim2.paseo",
    descriptor: paseo_individuality,
  },
} as const

const selected = (process.env.NETWORK ?? "previewnet") as keyof typeof NETWORKS
if (!(selected in NETWORKS)) throw new Error(`NETWORK=${selected}: expected one of ${Object.keys(NETWORKS).join(", ")}`)

export const NETWORK: (typeof NETWORKS)[keyof typeof NETWORKS] = NETWORKS[selected]

/** A typed papi client for the People chain. Call `client.destroy()` when done.
 *  (Both individuality chains expose the pallets and runtime APIs we touch, so
 *  the api is typed by the previewnet descriptor whichever network is picked.) */
export function connectPeople() {
  const client = createClient(getWsProvider(NETWORK.peopleWs))
  const api = client.getTypedApi(NETWORK.descriptor as typeof previewnet_individuality)
  return { client, api }
}
export type PeopleConnection = ReturnType<typeof connectPeople>
