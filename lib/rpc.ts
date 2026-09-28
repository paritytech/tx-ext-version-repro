/** Raw JSON-RPC over its own WebSocket, so the verdicts do not share papi's chain-head subscription. */
export function rpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error(`${method}: timed out`))
    }, 30_000)
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }))
    ws.onmessage = (message) => {
      clearTimeout(timer)
      ws.close()
      const reply = JSON.parse(String(message.data)) as { result?: T; error?: { code: number; message: string; data?: unknown } }
      if (reply.error) reject(new Error(`${reply.error.message}${reply.error.data ? ` ${JSON.stringify(reply.error.data)}` : ""}`))
      else resolve(reply.result as T)
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error(`${method}: websocket error`))
    }
  })
}

/** `author_submitAndWatchExtrinsic`: resolves with the status that ends the watch (inBlock / finalized / invalid / …). */
export function submitAndWatch(url: string, txHex: string, onStatus: (status: unknown) => void): Promise<{ ended: string; detail?: unknown }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("submitAndWatch: no block within 90s"))
    }, 90_000)
    const finish = (ended: string, detail?: unknown) => {
      clearTimeout(timer)
      ws.close()
      resolve({ ended, detail })
    }
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, jsonrpc: "2.0", method: "author_submitAndWatchExtrinsic", params: [txHex] }))
    ws.onmessage = (message) => {
      const reply = JSON.parse(String(message.data)) as { id?: number; error?: { message: string; data?: unknown }; params?: { result: unknown } }
      if (reply.id === 1 && reply.error) {
        clearTimeout(timer)
        ws.close()
        reject(new Error(`${reply.error.message}${reply.error.data ? ` ${JSON.stringify(reply.error.data)}` : ""}`))
        return
      }
      const status = reply.params?.result
      if (status === undefined) return
      onStatus(status)
      if (typeof status === "object" && status !== null) {
        const [kind, detail] = Object.entries(status)[0]!
        if (kind === "inBlock" || kind === "finalized" || kind === "usurped" || kind === "dropped" || kind === "invalid" || kind === "finalityTimeout") finish(kind, detail)
      } else if (status === "invalid" || status === "dropped") finish(String(status))
    }
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error("submitAndWatch: websocket error"))
    }
  })
}
