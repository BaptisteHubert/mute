/* eslint-disable @typescript-eslint/member-ordering */
import { ComponentFactoryResolver, Injectable, NgZone, OnDestroy } from "@angular/core";
import { Server } from "http";
import { Subject } from "rxjs/internal/Subject";
import { RichCollaborator } from "../rich-collaborators";
import { StreamId, Streams as MuteCoreStreams} from '@coast-team/mute-core'
import { IdMap } from "./idMap";
import { BehaviorSubject, Observable, Subscription } from "rxjs";

import { Message } from './message_proto'
import { EncryptionType } from "@app/core/crypto/EncryptionType.model";
import { NetfluxService } from "./solutions/netflux.service";
import { INetworkSolutionService } from "./solutions/network.solution.service";
import { KeyState } from "@coast-team/mute-crypto";
import { CryptoService } from "@app/core/crypto";
import { environment } from '@environments/environment'
import { Enum } from "protobufjs";
import { ActivatedRoute } from "@angular/router";

@Injectable()
export class NetworkServiceAbstracted implements OnDestroy {

    public server : Server
    public groupOfCollaborators : [RichCollaborator]

    public useGroup : boolean
    public useServer : boolean

    // Other
    private subs: Subscription[]

    public solution : INetworkSolutionService

    // idMap for the peers
    public idMap : IdMap
    public tempNetworkId : number

    // Connection state to the group of peers subject
    private groupConnectionStatusSubject: BehaviorSubject<number>
    public groupConnectionStatus : Enum

    // Connection state to the group of peers subject
    private serverConnectionStatusSubject: BehaviorSubject<number>
    public serverConnectionStatus : Enum

    // My network identifier
    public myNetworkId : number

    // Subjects related to the current peer
    private leaveSubject: Subject<number>

    // Network message subject
    private messageSubject: Subject<{ streamId: StreamId; content: Uint8Array; senderNetworkId: number }>

    // Peer Join/Leave subjects
    private memberJoinSubject: Subject<number>
    private memberLeaveSubject: Subject<number>

    public documentKey : string

    // ------------ Constructor ----------
    constructor(
      private zone: NgZone,
      private route: ActivatedRoute,
      private cryptoService: CryptoService){
        this.groupOfCollaborators = [null] // Starting out with an empty groupOfCollaborators
        //Initialize class variables
        this.idMap = new IdMap()
        this.leaveSubject = new Subject()
        this.messageSubject = new Subject()
        this.memberJoinSubject = new Subject()
        this.memberLeaveSubject = new Subject()
        this.subs = []

        // Connections status for the UI
        this.prepareGroupConnectionStatusEnum()
        this.prepareServerConnectionStatusEnum()
        this.groupConnectionStatusSubject = new BehaviorSubject(this.groupConnectionStatus.values['OFFLINE'])
        this.serverConnectionStatusSubject = new BehaviorSubject(this.serverConnectionStatus.values['CLOSED'])

        this.prepareNetworkLayer(zone, route, cryptoService)
    }


    // ------- Prepare Enum, and the network layer
    prepareNetworkLayer(zone: NgZone, route: ActivatedRoute, cryptoService: CryptoService){
      this.solution = new NetfluxService(this.messageSubject, this.groupConnectionStatusSubject, this.serverConnectionStatusSubject, this.memberJoinSubject, this.memberLeaveSubject, zone, cryptoService, route)
      this.useGroup = this.solution.useGroup()
      this.useServer = this.solution.useServer()
      this.retrieveNetworkId()
    }
    

    public prepareGroupConnectionStatusEnum(){
      this.groupConnectionStatus = new Enum("groupConnectionStatus")
      this.groupConnectionStatus.add("JOINING", 0)
      this.groupConnectionStatus.add("JOINED", 1)
      this.groupConnectionStatus.add("OFFLINE", 2)
      this.groupConnectionStatus.add("NO GROUP", 3)
    }

    public prepareServerConnectionStatusEnum(){
      this.serverConnectionStatus = new Enum("serverConnectionStatus")
      this.serverConnectionStatus.add("CONNECTING", 0)
      this.serverConnectionStatus.add("OPEN", 1)
      this.serverConnectionStatus.add("CHECKING", 2)
      this.serverConnectionStatus.add("CHECKED", 3)
      this.serverConnectionStatus.add("CLOSED", 4)
    }


    // ----------- Connect to the network --------
    public joinNetwork(key: string){
      this.solution.joinNetwork(key)
      this.documentKey = key
    }

    public leaveNetwork(){
      this.solution.leaveNetwork()
    }

    // ------- Handling collaborator joining and leaving ------
    addCollaboratorToGroup(rc : RichCollaborator){
      if (this.groupOfCollaborators[0] === null){
        this.groupOfCollaborators[0] = rc
      }
    }

    removeCollaboratorFromGroup(rcIndex : number){
      this.groupOfCollaborators.splice(rcIndex, 1)
    }

    // -------- Subjects getters related to server connectivy, members leaving, joining ------
    get onGroupConnectionStatusChange (): Observable<number> {
      return this.groupConnectionStatusSubject.asObservable()
    }

    get onServerConnectionStatusChange (): Observable<number> {
      return this.serverConnectionStatusSubject.asObservable()
    }

    get onMemberJoin (): Observable<number> {
      return this.memberJoinSubject.asObservable()
    }

    get onMemberLeave (): Observable<number> {
      return this.memberLeaveSubject.asObservable()
    }

    get onLeave (): Observable<number> {
      return this.leaveSubject.asObservable()
    }

    // ---------------- ENCRYPTION -------------------------------
    get cryptoState (): KeyState {
      return this.cryptoService.crypto.state
    }

    get onCryptoStateChange (): Observable<KeyState> {
      return this.cryptoService.onStateChange
    }


    // ---------------Sending Data -------------------------------
    get messageIn (): Observable<{ streamId: StreamId; content: Uint8Array; senderNetworkId: number }> {
      return this.messageSubject.asObservable()
    }

    retrieveNetworkId(){
      this.solution.myNetworkId.subscribe((myNetworkId) => {
        this.myNetworkId = myNetworkId
      })
    }

    /**
     * 
     * @param source 
     */
    setMessageOut(source: Observable<{ streamId: StreamId; content: Uint8Array; recipientNetworkId?: number }>) {
      this.subs[this.subs.length] = source.subscribe(({ streamId, content, recipientNetworkId }) => {
        if (streamId.type === MuteCoreStreams.DOCUMENT_CONTENT && environment.cryptography.type !== EncryptionType.NONE) {
          if (this.cryptoService.crypto.state === KeyState.READY){
            this.cryptoService.crypto.encrypt(content).then((encryptedContent) => {
              this.send(streamId, encryptedContent, recipientNetworkId)
            })
          }
        } else {
          this.send(streamId, content, recipientNetworkId)
        }
      })
    }

    send (streamId: StreamId, content: Uint8Array, id?: number): void {
      const msg = Message.create({ type: streamId.type, subtype: streamId.subtype, content })
      if (id === undefined) {
        this.solution.sendToAll(Message.encode(msg).finish())
      } else {
        if (id === 0){
          this.solution.sendRandom(Message.encode(msg).finish())
        } else {
          this.solution.sendTo(id, Message.encode(msg).finish())
        }
      }
    }

    randomCollaboratorNetworkId() : number{
      const otherCollaborators = this.groupOfCollaborators.filter((i) => i.networkId !== this.myNetworkId)
      return otherCollaborators[Math.ceil(Math.random() * otherCollaborators.length) - 1].networkId
    }

    // --------- Angular related function -------
    ngOnDestroy(): void {
      console.log("Destroyed the abstracted network service")
      this.leaveSubject.complete()
      this.messageSubject.complete()
      this.memberJoinSubject.complete()
      this.memberLeaveSubject.complete()
      this.groupConnectionStatusSubject.complete()
      this.serverConnectionStatusSubject.complete() 
      this.solution.myNetworkId.complete()
      this.solution.connectionState.complete()
      this.solution.leaveNetwork()
    }
}