import "dotenv/config"
const PORT = parseInt(process.env.PORT as string)

import { WebSocketServer, WebSocket } from "ws"
import BotManager from "./BotManager"

interface UserData {
  mode: "tribehouse" | "room"
  name: string
}
const userDataMap = new WeakMap<WebSocket, UserData>()

const wss = new WebSocketServer({ port: PORT }, () => {
  console.log("[WSS] ✔️  Started")
})

function send(ws: WebSocket, data: string) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(data)
}

function dispatch(data: string) {
  wss.clients.forEach((ws) => {
    send(ws, data)
  })
}

wss
  .on("close", () => {
    console.log("[WSS] ❌ Closed")
    botManager.kill()
    process.exit(0)
  })
  .on("error", (error) => {
    console.log("[WSS] ❌ Error:", error.message)
  })
  .on("listening", () => {
    console.log("[WSS] 👉 Listening")
  })

  .on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress || "(unknown)"
    console.log("[WSS] 👉 Client connected:", ip)
    send(ws, JSON.stringify({ isBotOnline: botManager.ready }))
    ws.on("close", (code, reason) => {
      console.log("[WSS] 👉 Client closed:", ip, code, reason.toString())
      userDataMap.delete(ws)
    })
      .on("error", (error) => {
        console.log("[WSS] ❌ Client errored:", ip, error)
      })
      .on("message", (data) => {
        const str = data.toString()
        if (!str.length) {
          send(ws, "")
          return
        }
        try {
          const json = JSON.parse(str)
          handleMessage(ws, ip, json)
        } catch (e) {
          console.log("[WSS] Client sent invalid JSON:", ip, str)
          ws.close(4000, "Invalid JSON")
        }
      })
  })

function handleMessage(ws: WebSocket, ip: string, data: any) {
  if ("name" in data && typeof data["name"] === "string") {
    const name: string = data["name"]
    const userData = userDataMap.get(ws)
    if (userData && userData.name === name) return
    console.log("[WSS] Client sent name:", ip, name)
    userDataMap.set(ws, { mode: "tribehouse", name })
  } else if ("room" in data && typeof data["room"] === "string") {
    const name: string = data["room"]
    const userData = userDataMap.get(ws)
    if (userData && userData.name === name) return
    console.log("[WSS] Client sent room:", ip, name)
    userDataMap.set(ws, { mode: "room", name })
  } else if ("xml" in data && typeof data["xml"] === "string") {
    const xml: string = data["xml"]
    console.log(
      "[WSS] Client sent XML:",
      ip,
      xml.length <= 5 ? xml : xml.slice(0, 5) + `...(${xml.length} chars)`,
    )
    const userData = userDataMap.get(ws)
    if (!userData) {
      send(
        ws,
        JSON.stringify({
          hasTribehouseAccess: false,
        }),
      )
      return
    }
    enqueueRequest({
      ws,
      xml: xml,
      ...userData,
    })
      .then(() => {
        if (userData.mode === "tribehouse") {
          send(
            ws,
            JSON.stringify({
              hasTrighouseAccess: true,
              isModuleLoaded: true,
            }),
          )
        } else {
          send(ws, "ok")
        }
      })
      .catch((o) => {
        console.log("[WSS] Request failed:", ip)
        if (o) {
          send(ws, JSON.stringify(o))
        }
      })
  } else {
    ws.close(4000, "Invalid message")
  }
}

export interface MapLoadingRequest extends UserData {
  ws: WebSocket
  xml: string
  promise: {
    resolve: (r: any) => void
    reject: (o: {
      hasTribehouseAccess?: boolean
      isModuleLoaded?: boolean
    }) => void
  }
}

let requestQueue = [] as MapLoadingRequest[]
function getNextRequest() {
  return requestQueue.shift()
}
function processNextRequest() {
  if (!botManager.available) return
  const request = getNextRequest()
  if (request) botManager.processRequest(request, getNextRequest)
}

const botManager = new BotManager()
  .on("disconnect", () => {
    requestQueue = []
    dispatch(JSON.stringify({ isBotOnline: false }))
  })
  .on("ready", () => {
    dispatch(JSON.stringify({ isBotOnline: true }))
  })
  .on("available", (available) => {
    if (!available) return
    processNextRequest()
  })

function enqueueRequest(request: Omit<MapLoadingRequest, "promise">) {
  // Ovewrite a previous unfullfilled request from the same user
  requestQueue = requestQueue.filter((r) => r.ws !== request.ws)
  if (!botManager.ready || requestQueue.length > 20) {
    return Promise.reject()
  }
  return new Promise((resolve, reject) => {
    const promise = { resolve, reject }
    // Consider the request redundant after 10 seconds
    setTimeout(() => {
      reject()
      requestQueue = requestQueue.filter((r) => r.promise !== promise)
    }, 10000)
    requestQueue.push({ ...request, promise })
    processNextRequest()
  })
}
