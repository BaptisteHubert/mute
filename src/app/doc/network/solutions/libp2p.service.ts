/* eslint-disable prefer-arrow/prefer-arrow-functions */
/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable @typescript-eslint/member-ordering */
// @ts-nocheck
import { NgZone } from "@angular/core";
import { CryptoService } from "@app/core/crypto";
import { environment } from "@environments/environment";
import { BehaviorSubject, Subject } from "rxjs";
import { INetworkSolutionService } from "./network.solution.service"
import { StreamId, Streams, Streams as MuteCoreStreams, StreamsSubtype } from '@coast-team/mute-core'
import { ActivatedRoute } from "@angular/router";
import { NetworkSolutionServiceFunctions } from "./network.solution.services.functions";

import { Libp2p, createLibp2p } from 'libp2p'
import { WebRTCStar } from '@libp2p/webrtc-star'
import { Mplex  } from '@libp2p/mplex'
import { Multiaddr } from '@multiformats/multiaddr'
import { Noise } from '@chainsafe/libp2p-noise'
import { pipe } from 'it-pipe'

const PROTOCOL = '/chat/1.0.0'

export class Libp2pService extends NetworkSolutionServiceFunctions implements INetworkSolutionService{

    public libp2pInstance : Libp2p
 
    public myNetworkId: Subject<number>
    public peers : number[]
    public neighbors: number[];
    public connectionState: Subject<boolean>
    public addrLibp2p : string

    // Fix for the key agreement protocol where 
    public peerIdAsNumbers  : Map<string, number>
    public peerIdAsNumbersReverse : Map<number, string>

    constructor(
      private messageReceived: Subject<{ streamId: StreamId; content: Uint8Array; senderNetworkId: number }>,
      private groupConnectionStatusSubject: BehaviorSubject<number>,
      private serverConnectionStatusSubject: BehaviorSubject<number>,
      private memberJoinSubject : Subject<number>,
      private memberLeaveSubject : Subject<number>,
      private zone: NgZone, 
      private cryptoService: CryptoService,
      private route: ActivatedRoute
       ){
        super()
        console.log("USING Libp2p")
        this.cryptoService = cryptoService
        this.myNetworkId = new Subject
        this.peers = []
        this.connectionState = new Subject
        this.connectionState.next(false)
        this.libp2pInstance = this.initLibp2()

        this.peerIdAsNumbers = new Map()
        this.peerIdAsNumbersReverse = new Map()

        this.configureNetworkBehavior()
        this.messageReceived = messageReceived
    }

    async initLibp2() : Promise<Libp2p>{
      const webRtcStar = new WebRTCStar()
      const transportKey = WebRTCStar.prototype[Symbol.toStringTag]
      const libp2p = await createLibp2p({
        addresses: {
          listen: [
            environment.p2p.libp2pAddr
          ]
        },
        transports: [
          webRtcStar
        ],
        connectionEncryption: [new Noise()],
        streamMuxers: [new Mplex()],
        peerDiscovery: [
          webRtcStar.discovery
        ]
        ,
        config: {
          transport: {
            [transportKey]: {
              listenerOptions: {
                config: {
                  iceServers: [
                    {"urls": "stun:openrelay.metered.ca:80"},
                    {"urls": ["turn:openrelay.metered.ca:80"], "username": "openrelayproject", "credential": "openrelayproject"},
                    {"urls": ["turn:openrelay.metered.ca:443"], "username": "openrelayproject", "credential": "openrelayproject"},
                    {"urls": ["turn:openrelay.metered.ca:443?transport=tcp"], "username": "openrelayproject", "credential": "openrelayproject"}
                  ]
                }
              }
            }
          }
        }
      })
      this.configureAsyncNetworkBehavior(libp2p)
      await libp2p.start()
      this.libp2pInstance = await libp2p
      this.addPeerIdAsNumberToMap(this.libp2pInstance.peerId.toString())
      this.myNetworkId.next(this.peerIdAsNumbers.get(this.libp2pInstance.peerId.toString()))
    }

    generateNumberFromPeerId(peerId : string) : number{
      let peerIdAsNumber = 0
      // eslint-disable-next-line guard-for-in
      for (const index in peerId){
        const char = peerId[index]
        if (char === char.toUpperCase()){
          peerIdAsNumber += char.charCodeAt(0) * 2
        } else {
          peerIdAsNumber += char.charCodeAt(0)
        }
        if (/^[0-9]$/.test(char)){
          peerIdAsNumber += Number(char)
        }
      }
      peerIdAsNumber = peerIdAsNumber * 15
      return peerIdAsNumber
    }

    addPeerIdAsNumberToMap(peerId : string){
      const peerIdAsNumberGenerated = this.generateNumberFromPeerId(peerId)
      this.peerIdAsNumbers.set(peerId, peerIdAsNumberGenerated)
      this.peerIdAsNumbersReverse.set(peerIdAsNumberGenerated, peerId)
    }

    removePeerIdAsNumberFromMap(peerId : string){
      const peerIdAsNumberGenerated = this.peerIdAsNumbers.get(peerId)
      this.peerIdAsNumbers.delete(peerId)
      this.peerIdAsNumbersReverse.delete(peerIdAsNumberGenerated)
    }

    // TODO - Implements code for libp2p to try to reconnect to signaling server after some time
    send (streamId: StreamId, content: Uint8Array, peers : number[], id?: number): void {
      super.send(streamId, content, peers, id)
    }
    
    sendToAll(message : Uint8Array){
      for (const key of this.peers) {
        const peerId = this.peerIdAsNumbersReverse.get(key)
        const peerAddr = new Multiaddr(environment.p2p.libp2pAddr + "p2p/" + peerId)
        this.sendAsync(message, peerAddr)
      }
    }

    sendRandom(message : Uint8Array){
      const peerAddr = new Multiaddr(addr + this.randomPeer(this.peers))
      this.sendAsync(message, peerAddr)
    }

    sendTo(recipientNetworkId: number, message : Uint8Array){
      const peerAddr = new Multiaddr(environment.p2p.libp2pAddr + "p2p/" + this.peerIdAsNumbersReverse.get(recipientNetworkId))
      this.sendAsync(message, peerAddr)
    }

    async sendAsync(messageToSend : Uint8Array, peerMultiAddr : Multiaddr){
      try {
        const { stream } = await this.libp2pInstance.dialProtocol(peerMultiAddr, [PROTOCOL])
        await pipe([messageToSend], await stream) 
        stream.close()
      } catch (err) {
        console.error('Could not send the message', err)
      }
    }

    /**
     * asynchronously handles the network behavior for sets of events
     * @param libp2p 
     */
    async configureAsyncNetworkBehavior(libp2p : Libp2p){
      //Receiving message
      libp2p.handle('/chat/1.0.0', 
        ({ connection, stream} ) => {
        const me = this
        pipe(stream, async function (source: AsyncGenerator<any, any, any>) {
          for await (const msg of source) {
            const remotePeerId = connection.remotePeer.string
            me.handleIncomingMessage(msg, me.messageReceived, me.peerIdAsNumbers.get(remotePeerId), me.cryptoService)
          }
          stream.close()
        })
      })

      //Handling peers joining or leaving
      libp2p.connectionManager.addEventListener('peer:connect', (evt) => {
        const connection = evt.detail
        const remotePeerId = connection.remotePeer.toString()
        console.log(`Connected to ${remotePeerId}`)
        this.addPeerIdAsNumberToMap(remotePeerId)
        this.peers.push(this.peerIdAsNumbers.get(remotePeerId))
        this.memberJoinSubject.next(this.peerIdAsNumbers.get(remotePeerId))
      })
      libp2p.connectionManager.addEventListener('peer:disconnect', (evt) => {
        const connection = evt.detail
        const remotePeerId = connection.remotePeer.toString()
        console.log(`Disconnected from ${remotePeerId}`)
        const indexOfPeer = this.peers.indexOf(this.peerIdAsNumbers.get(remotePeerId))
        if (indexOfPeer !== -1){
          this.peers.splice(indexOfPeer,1)
        }
        this.memberLeaveSubject.next(this.peerIdAsNumbers.get(remotePeerId))
        this.removePeerIdAsNumberFromMap(remotePeerId)
      })
    }

    // Handling how message are sent, received, members join
    configureNetworkBehavior(){
      this.cryptoService.handleCryptographyProcess(this.route, this, this.memberJoinSubject, this.memberLeaveSubject)
    } 

    // Generic Functions 
    // Initializing connection to the webGroup
    joinNetwork(key : string){
      if (this.libp2pInstance.isStarted()){
        this.handleStateConnection(1, this.groupConnectionStatusSubject, this.connectionState)
      } else {
       this.libp2pInstance.start()
       this.handleStateConnection(1, this.groupConnectionStatusSubject, this.connectionState)
      }
    }

    leaveNetwork(){
      this.libp2pInstance.stop()
      this.handleStateConnection(2, this.groupConnectionStatusSubject, this.connectionState)
    }

    // Function to know if the collaborators should be seen in the UI
    useGroup(){
      return true
    }

    useServer(){
      return true
    }
}