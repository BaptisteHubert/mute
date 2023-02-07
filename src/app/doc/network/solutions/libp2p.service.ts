/* eslint-disable guard-for-in */
/* eslint-disable prefer-arrow/prefer-arrow-functions */
/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable @typescript-eslint/member-ordering */
// @ts-nocheck
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


import { fromString, toString} from 'uint8arrays'

const PROTOCOL = '/chat/1.0.0'

export class Libp2pService extends NetworkSolutionServiceFunctions implements INetworkSolutionService{

    public myNetworkId: Subject<number>
    public peers : number[]
    public neighbors: number[];
    public connectionState: Subject<boolean>

    public libp2pInstance : Libp2p
    public peerIdAsNumbers  : Map<string, number>
    public peerIdAsNumbersReverse : Map<number, string>
    public currentDocumentKey : string
    public peersOnTheSameDocument : string[]

    constructor(
      private messageReceived: Subject<{ streamId: StreamId; content: Uint8Array; senderNetworkId: number }>,
      private groupConnectionStatusSubject: BehaviorSubject<number>,
      private serverConnectionStatusSubject: BehaviorSubject<number>,
      private memberJoinSubject : Subject<number>,
      private memberLeaveSubject : Subject<number>,
      private cryptoService: CryptoService,
      private route: ActivatedRoute
       ){
        super()
        this.cryptoService = cryptoService
        this.myNetworkId = new Subject
        this.peers = []
        this.connectionState = new Subject
        this.connectionState.next(false)
        
        this.peerIdAsNumbers = new Map()
        this.peerIdAsNumbersReverse = new Map()
        this.peersOnTheSameDocument = []
        this.isTheSignalingServerReachable = false
        this.libp2pInstance = this.initLibp2()
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


    send (streamId: StreamId, content: Uint8Array, peers : number[], id?: number): void {
      super.send(streamId, content, peers, id)
    }
    
    sendToAll(message : Uint8Array){
      for (const key of this.peers) {
        const peerId = this.peerIdAsNumbersReverse.get(key)
        if (peerId){
          const peerAddr = new Multiaddr(environment.p2p.libp2pAddr + "p2p/" + peerId)
          this.sendAsync(message, peerAddr)
        }
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
     * Configure network behavior for the cryptographyProcess
     */
    configureNetworkBehavior(){
      this.cryptoService.handleCryptographyProcess(this.route, this, this.memberJoinSubject, this.memberLeaveSubject)
    } 

    /**
     * asynchronously handles the network behavior for sets of events
     * @param libp2p 
     */
    async configureAsyncNetworkBehavior(libp2p : Libp2p){
      //Receiving messages
      libp2p.handle(PROTOCOL, 
        ({ connection, stream} ) => {
        const me = this
        pipe(stream, async function (source: AsyncGenerator<any, any, any>) {
          for await (const msg of source) {
            const remotePeerId = connection.remotePeer.string
            if (me.isAPeerDocumentKeyMessage(msg)){
              me.handlePeerIdsDocumentKey(remotePeerId, msg)
            } else {
              me.handleIncomingMessage(msg, me.messageReceived, me.peerIdAsNumbers.get(remotePeerId), me.cryptoService)
            }
          }
          stream.close()
        })
      })

      //Handling peers joining or leaving
      libp2p.addEventListener('peer:discovery', (evt) => {
        const peer = evt.detail
        const remotePeerId = peer.id.toString()
        if (this.isOnTheSameDocument(remotePeerId)){
          const connectionToPeer = new Multiaddr(environment.p2p.libp2pAddr + "p2p/" + remotePeerId)
          if (this.libp2pInstance.connectionManager.getConnections(connectionToPeer).length < 1){
            libp2p.connectionManager.openConnection(connectionToPeer)
          }
        }
      })
      libp2p.connectionManager.addEventListener('peer:connect', (evt) => {
        const connection = evt.detail
        const remotePeerId = connection.remotePeer.toString()
        this.broadcastMyDocumentKey(remotePeerId)
        if (this.isOnTheSameDocument(remotePeerId)){
            this.addPeerIdAsNumberToMap(remotePeerId)
            if (this.peers.indexOf(this.peerIdAsNumbers.get(remotePeerId)) === -1){
              this.peers.push(this.peerIdAsNumbers.get(remotePeerId))
              this.memberJoinSubject.next(this.peerIdAsNumbers.get(remotePeerId))
            }
        } else {
            libp2p.connectionManager.closeConnections(new Multiaddr(environment.p2p.libp2pAddr + "p2p/" + remotePeerId))
        }
      })
      libp2p.connectionManager.addEventListener('peer:disconnect', (evt) => {
        const connection = evt.detail
        const remotePeerId = connection.remotePeer.toString()
        const indexOfPeer = this.peers.indexOf(this.peerIdAsNumbers.get(remotePeerId))
        if (indexOfPeer !== -1){
          this.peers.splice(indexOfPeer,1)
        }
        this.memberLeaveSubject.next(this.peerIdAsNumbers.get(remotePeerId))
        this.removePeerIdAsNumberFromMap(remotePeerId)
      })
    }

    /**
     * Joining the network and initializing libp2p
     * @param key the document Key
     */
    joinNetwork(key : string){
      this.currentDocumentKey = key
      if (this.libp2pInstance){
        if (this.libp2pInstance.isStarted()){
          this.handleStateConnection(1, this.groupConnectionStatusSubject, this.connectionState)
        } else {
          this.libp2pInstance.start()
          this.handleStateConnection(1, this.groupConnectionStatusSubject, this.connectionState)
        }
      }
    }

    /**
     * Leaving the document and stopping libp2p
     */
    leaveNetwork(){
      const listOfPeersConnectedToMe = this.libp2pInstance.getPeers()
      const numberOfPeersConnectedToMe = listOfPeersConnectedToMe.length
      if (numberOfPeersConnectedToMe > 0){
        for (const peer of listOfPeersConnectedToMe){
          const addrPeerHangUp = new Multiaddr(environment.p2p.libp2pAddr + "p2p/" + peer.toString())
          this.libp2pInstance.hangUp(addrPeerHangUp)
        }
      }
      this.libp2pInstance.stop()
      this.handleStateConnection(2, this.groupConnectionStatusSubject, this.connectionState)
    }

    // Handling the peer routing
    /**
     * Send my current document key to the peer i'm trying to connect to
     * @param remotePeerId the peer i'm sending the document Key to
     */
    broadcastMyDocumentKey(remotePeerId : string) : void{
      const documentKey = "myDocKey:" + this.currentDocumentKey
      this.sendAsync(fromString(documentKey), new Multiaddr(environment.p2p.libp2pAddr + "p2p/" + remotePeerId))
    }
    
    /**
     * Check if the document key given by another peer is the same as mine
     * @param remotePeerId the peerID that broadcasted his document key
     * @param messageDocumentKey the message he sent containing the document key
     */
    handlePeerIdsDocumentKey(remotePeerId : string, messageDocumentKey : Uint8Array){
      const messageDocumentKeyAsString = toString(messageDocumentKey)
      const sizeMessageDocumentKeyAsString = messageDocumentKeyAsString.length
      if (messageDocumentKeyAsString.slice(9, sizeMessageDocumentKeyAsString) === this.currentDocumentKey){
        if (this.peersOnTheSameDocument.indexOf(remotePeerId) === -1){
          this.peersOnTheSameDocument.push(remotePeerId)
        }
      }
    }

    /**
     * Loop through the known peer that are on the same document to find if the peerID is in it
     * @param remotePeerId the peerID to test
     * @returns true if the peer is on the same document, false otherwise
     */
    isOnTheSameDocument(remotePeerId : string) : boolean{
      let found = 0
      for (const peerId of this.peersOnTheSameDocument){
        if (peerId === remotePeerId){
          found ++
        }
      } 
      if (found > 0){
        return true
      } else {
        return false
      }
    }

    /**
     * Verify if a message received is a message broadcasting the documentKey   
     * @param message the message broadcasted by another peer
     * @returns 
     */
    isAPeerDocumentKeyMessage(message : Uint8Array){
      if (toString(message).slice(0,9) === "myDocKey:"){
        return true
      } else {
        return false
      }
    }

    // Handling the peerID string/number situation
    /**
     * Generates a number from a given peerID
     * @param peerId the source peerID
     * @returns a number representing the peerID
     */
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

    /**
     * Generates a number from the peerID and pushes it to the corresponding map
     * @param peerId the peerID to add
     */
    addPeerIdAsNumberToMap(peerId : string){
      const peerIdAsNumberGenerated = this.generateNumberFromPeerId(peerId)
      this.peerIdAsNumbers.set(peerId, peerIdAsNumberGenerated)
      this.peerIdAsNumbersReverse.set(peerIdAsNumberGenerated, peerId)
    }

    /**
     * Removes the number generated from the peerID from the corresponding map
     * @param peerId the peerID to remove
     */
    removePeerIdAsNumberFromMap(peerId : string){
      const peerIdAsNumberGenerated = this.peerIdAsNumbers.get(peerId)
      this.peerIdAsNumbers.delete(peerId)
      this.peerIdAsNumbersReverse.delete(peerIdAsNumberGenerated)
    }

    // Function to know if the collaborators should be seen in the UI
    useGroup(){
      return true
    }

    useServer(){
      return true
    }
}