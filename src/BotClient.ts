const { BOT_NAME, BOT_PASS } = process.env as {
  BOT_NAME: string
  BOT_PASS: string
}

import * as tfmjs from "@cheeseformice/transformice.js"
import { Client, enums, Room } from "@cheeseformice/transformice.js"
import { EventEmitter } from "ws"
import { MapLoadingRequest } from "."

function getFullRoomName(name: string) {
  return `*#bolodefchoco miceditor ${name}`
}

const extraIdentifiers = {
  tribehouseInvitation: tfmjs.Identifier(16, 2),
  acceptTribehouseInvitation: tfmjs.Identifier(16, 2),
  popup: tfmjs.Identifier(29, 23),
  answerPopup: tfmjs.Identifier(29, 20),
}

const roomSwitchCooldown = 1500
export default class BotClient extends EventEmitter {
  client: Client
  breakRoom = getFullRoomName("entibot")
  lastRoomChange = Date.now()
  /** Maps player name to tribe name */
  tribehouseInvitations: Map<string, string> = new Map()

  constructor() {
    super()

    this.client = new Client(BOT_NAME, BOT_PASS, {
      language: enums.Language.en,
      autoReconnect: false,
      loginRoom: this.breakRoom,
    })
      .on("rawPacket", (conn, ccc, packet) => {
        // console.log(ccc, IdentifierSplit(ccc))

        if (ccc === extraIdentifiers.tribehouseInvitation) {
          const name = packet.readUTF()
          const tribeName = packet.readUTF()
          this.client.emit("tribeInvite" as any, name, tribeName)
        } else if (ccc === extraIdentifiers.popup) {
          const popupId = packet.readInt()
          const popupType = packet.readByte()
          const title = packet.readUTF()
          if (popupType !== 2) return
          this.client.emit("popup" as any, popupId, title)
        }
      })
      .on("disconnect", () => {
        console.log("[BOT] ❌ Disconnected")
        this.emit("disconnect")
        this.emit("available", false)
      })
      .on("connectionError", (e) => {
        console.log("[BOT] ❌ Disconnected (connection error):", e.message)
        this.emit("disconnect")
        this.emit("available", false)
      })
      .on("restart", () => {
        console.log("[BOT] 👉 Restarting...")
      })
      .on("ready", () => {
        console.log("[BOT] ✔️  Ready")
        this.tribehouseInvitations.clear()
        this.emit("ready")
        this.emit("available", true)
      })
      .on("roomChange", ({ name }) => {
        console.log(`[BOT] Entered room '${name}'`)
        this.lastRoomChange = Date.now()
      })
      //@ts-ignore
      .on("tribeInvite", (name: string, tribeName: string) => {
        console.log(
          `[BOT] Received tribehouse invite from ${name}: '${tribeName}'`,
        )
        this.tribehouseInvitations.set(name, tribeName)
      })
      //@ts-ignore
      .on("popup", () => {
        console.log("[BOT] Popup received")
      })
      .on("whisper", (msg) => {
        if (msg.author.name === this.client.name) return
        console.log(`[BOT] Whisper from ${msg.author.name}: '${msg.content}'`)
        // if (msg.content.toLowerCase().includes("disconnect")) {
        //   this.client.disconnect()
        // }
      })
  }

  start() {
    console.log("[BOT] 👉 Starting...")
    this.client
      .run()
      .then(() => {
        console.log("[BOT] 👉 Connecting...")
        this.client.waitFor("ready", 15000).catch(() => {
          console.log("[BOT] ❌ Couldn't connect to server")
          this.emit("disconnect")
        })
      })
      .catch((error) => {
        console.log("[BOT] ❌ Failed to start:", error.message)
        this.emit("disconnect")
      })
    return this
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async switchRoom(
    sendPacket: () => void,
    roomCondition: (room: Room) => boolean,
  ): Promise<void> {
    if (this.client.room && roomCondition(this.client.room)) {
      console.log(`[BOT] Already in room '${this.client.room.name}'`)
      return
    }
    const sleepDelay = roomSwitchCooldown - (Date.now() - this.lastRoomChange)
    if (sleepDelay > 0) await this.sleep(sleepDelay)
    for (let i = 0; i < 10; i++) {
      try {
        if (this.client.room && roomCondition(this.client.room)) return
        sendPacket()
        await this.client.waitFor("roomChange", 500 + i * 50, roomCondition)
        return
      } catch (e) {}
    }
    console.log(`[BOT] Failed to switch to target room`)
  }

  async processRequest(
    request: MapLoadingRequest,
    getNextRequest: () => MapLoadingRequest | undefined,
  ): Promise<void> {
    console.log("[BOT] Processing request...")
    // console.log("[BOT] Current room:", this.client.room.name)
    this.emit("available", false)
    await this._processRequest(request)
    const nextRequest = getNextRequest()
    if (nextRequest) {
      return this.processRequest(nextRequest, getNextRequest)
    }
    await this.goToBreakRoom().catch((e) => {
      console.log("[BOT] ❌ Couldn't go back to break room...")
      this.client.disconnect()
    })
    this.emit("available", true)
  }

  protected _processRequest(request: MapLoadingRequest): Promise<void> {
    if (request.mode === "tribehouse") {
      const playerName = request.name
      const tribeName = this.tribehouseInvitations.get(playerName)
      if (!tribeName) {
        request.promise.reject({ hasTribehouseAccess: false })
        return Promise.resolve()
      }
      return this.joinUserTribe(playerName, tribeName)
        .then(() => {
          return this.loadMapUsingPopup(request.xml)
            .then(() => {
              request.promise.resolve("ok")
            })
            .catch((e) => {
              console.log(
                "[BOT] Couldn't load map in tribehouse:",
                playerName,
                e.message,
              )
              request.promise.reject({
                hasTribehouseAccess: true,
                isModuleLoaded: false,
              })
            })
        })
        .catch((e) => {
          console.log("[BOT] Couldn't join tribe house:", playerName, e.message)
          request.promise.reject({ hasTribehouseAccess: false })
        })
    } else {
      const roomName = getFullRoomName(request.name)
      return this.switchRoom(
        () => this.client.enterRoom(roomName),
        (room) => room.name === roomName,
      )
        .then(() => {
          return this.loadMapUsingPopup(request.xml)
            .then(() => {
              request.promise.resolve("ok")
            })
            .catch((e) => {
              console.log(
                "[BOT] Couldn't load map in module room:",
                roomName,
                e.message,
              )
              request.promise.reject({})
            })
        })
        .catch((e) => {
          console.log("[BOT] Couldn't join module room:", roomName, e.message)
          request.promise.reject({})
        })
    }
  }

  async joinUserTribe(playerName: string, tribeName: string) {
    try {
      await this.switchRoom(
        () =>
          this.client.main.send(
            extraIdentifiers.acceptTribehouseInvitation,
            new tfmjs.ByteArray().writeUTF(playerName),
          ),
        (room) => room.isTribeHouse && room.name.includes(tribeName),
      )
    } catch (e: any) {
      this.client.sendWhisper(
        playerName,
        "Invite me to your tribehouse: /inv Entibot#5692",
      )
      throw new Error("Failed to join tribehouse: " + e.message)
    }
  }

  async loadMapUsingPopup(xml: string) {
    try {
      this.client.sendRoomMessage("!You need to run the module first! (/lua)")
      const [popupId] = await this.client.waitFor(
        //@ts-ignore
        "popup",
        2000,
        (popupId, title) => popupId === 5692 && title === "xml",
      )
      if (xml !== "") {
        this.client.bulle.send(
          extraIdentifiers.answerPopup,
          new tfmjs.ByteArray().writeInt(popupId as number).writeUTF(xml),
        )
      }
    } catch (e: any) {
      throw new Error("Didn't receive a popup: " + e.message)
    }
  }

  async goToBreakRoom() {
    await this.switchRoom(
      () => this.client.enterRoom(this.breakRoom),
      (room) => room.name === this.breakRoom,
    )
  }
}
