import { EventEmitter } from "ws"
import BotClient from "./BotClient"
import { MapLoadingRequest } from "."

const reconnectDelays = [
  100, 1000, 5000, 5000, 30000, 60000, 60000, 60000, 60000, 300000,
]
export default class BotManager extends EventEmitter {
  botClient!: BotClient
  numConnectAttempts = 0
  ready = false
  available = false
  constructor() {
    super()
    this.startBotClient()
  }
  startBotClient() {
    this.botClient = new BotClient()
      .on("disconnect", () => {
        if (this.ready) {
          this.emit("disconnect")
        }
        this.ready = this.available = false
        this.botClient.client.removeAllListeners()
        //@ts-ignore
        this.botClient = null
        const reconnectDelay =
          reconnectDelays[
            Math.min(this.numConnectAttempts, reconnectDelays.length - 1)
          ]
        setTimeout(() => this.startBotClient(), reconnectDelay)
        this.numConnectAttempts++
      })
      .on("ready", () => {
        this.numConnectAttempts = 0
        this.ready = true
        this.emit("ready")
      })
      .on("available", (available) => {
        this.available = available
        this.emit("available", available)
      })
      .start()
  }
  async processRequest(
    request: MapLoadingRequest,
    getNextRequest: () => MapLoadingRequest | undefined,
  ): Promise<void> {
    if (!this.available) {
      console.log("[BOT] This should never happen")
    }
    this.botClient.processRequest(request, getNextRequest)
  }
  kill() {
    if (this.botClient) {
      this.botClient.client.disconnect()
    }
  }
}
