/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable @typescript-eslint/member-ordering */
import { NgZone } from "@angular/core";
import { CryptoService } from "@app/core/crypto";
import { EncryptionType } from "@app/core/crypto/EncryptionType.model";
import { environment } from "@environments/environment";
import { WebGroup, WebGroupState } from "netflux";
import { BehaviorSubject, Subject } from "rxjs";
import { Message } from "../message_proto";
import { INetworkSolutionService } from "./network.solution.service"
import { StreamId, Streams, Streams as MuteCoreStreams, StreamsSubtype } from '@coast-team/mute-core'
import { KeyAgreementBD, KeyState, Streams as MuteCryptoStreams, Symmetric } from '@coast-team/mute-crypto'
import { ActivatedRoute } from "@angular/router";
import { NetworkSolutionServiceFunctions } from "./network.solution.services.functions";

export class NetfluxService extends NetworkSolutionServiceFunctions implements INetworkSolutionService{

    public myNetworkId: Subject<number>
    public peers : number[]
    public neighbors: number[];
    public connectionState: Subject<boolean>
    public wg: WebGroup

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
        console.log("USING NETFLUX")
        this.myNetworkId = new Subject
        this.peers = []
        this.connectionState = new Subject
        this.connectionState.next(false)
        this.zone.runOutsideAngular(() => {
            this.wg = new WebGroup({
              signalingServer: environment.p2p.signalingServer,
              rtcConfiguration: environment.p2p.rtcConfiguration,
            })
            window.wg = this.wg
            this.wg.onSignalingStateChange = (state) => this.serverConnectionStatusSubject.next(state)
            this.configureNetworkBehavior()
        })
        this.cryptoService = cryptoService
        this.messageReceived = messageReceived
    }

    // Initializing connection to the webGroup
    joinNetwork(key : string){ 
      this.wg.join(key)
    }

    leaveNetwork(){
      this.wg.leave()
    }

    // Function to know if the collaborators should be seen in the UI
    useGroup(){
      return true
    }

    useServer(){
      return true
    }

    send (streamId: StreamId, content: Uint8Array, peers : [number], id?: number): void {
      super.send(streamId, content, peers, id)
    }


    sendToAll(message : Uint8Array){
        this.wg.send(message)
    }

    sendRandom(message : Uint8Array){
        this.wg.sendTo(this.randomMember(), message)
    }

    sendTo(recipientNetworkId: number, message : Uint8Array){
        this.wg.sendTo(recipientNetworkId, message)
    }

    private randomMember(): number {
      const otherMembers = this.members.filter((i) => i !== this.wg.myId)
      return otherMembers[Math.ceil(Math.random() * otherMembers.length) - 1]
    }

    //getters, setters
    get members (): number[] {
      return this.wg.members
    }

    // Handling how message are sent, received, members join
    configureNetworkBehavior(){
      this.cryptoService.handleCryptographyProcess(this.route, this, this.memberJoinSubject, this.memberLeaveSubject)
      this.wg.onMemberJoin = (networkId) => {
        this.peers.push(networkId)
        this.memberJoinSubject.next(networkId)
      }
      this.wg.onMemberLeave = (networkId) => {
        const indexPeer = this.peers.findIndex((p) => p === networkId)
        this.peers.splice(indexPeer, 1)
        this.memberLeaveSubject.next(networkId)
      }
      this.wg.onMyId = (id) => {
        this.myNetworkId.next(id)
      }
      this.wg.onStateChange = (state: WebGroupState) => {
        this.handleStateConnection(state, this.groupConnectionStatusSubject, this.connectionState)
      } 
      this.wg.onMessage = (networkId, bytes: Uint8Array) => {
        try { 
          this.handleIncomingMessage( bytes, this.messageReceived, networkId, this.cryptoService)
          } catch (err) {
          log.warn('Message from network decode error: ', err.message)
        }
      }
    } 
}