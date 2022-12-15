/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable @typescript-eslint/member-ordering */
import { ComponentFactoryResolver, NgZone } from "@angular/core";
import { CryptoService } from "@app/core/crypto";
import { EncryptionType } from "@app/core/crypto/EncryptionType.model";
import { Doc } from "@app/core/Doc";
import { environment } from "@environments/environment";
import { WebGroup, WebGroupState } from "netflux";
import { BehaviorSubject, Subject } from "rxjs";
import { Message } from "../message_proto";
import { INetworkSolutionService } from "./network.solution.service"
import { StreamId, Streams, Streams as MuteCoreStreams } from '@coast-team/mute-core'
import { ActivatedRoute } from "@angular/router";
import { Symmetric } from "@coast-team/mute-crypto";
import { filter } from "rxjs/operators";

export class NetfluxService implements INetworkSolutionService{

    public myNetworkId: number;

    public neighbors: [number];

    public wg: WebGroup

    public connectionState: Subject<boolean>

    
    constructor(
      private messageReceived: Subject<{ streamId: StreamId; content: Uint8Array; senderNetworkId: number }>,
      private connectionGroupStatusSubject: BehaviorSubject<number>,
      private serverConnectionStatusSubject: BehaviorSubject<number>,
      private memberJoinSubject : Subject<number>,
      private memberLeaveSubject : Subject<number>,
      private zone: NgZone, 
      private cryptoService: CryptoService,
      private route: ActivatedRoute
       ){
        console.log("USING NETFLUX")
        this.connectionState = new Subject
        this.connectionState.next(false)
        this.zone.runOutsideAngular(() => {
            this.wg = new WebGroup({
              signalingServer: environment.p2p.signalingServer,
              rtcConfiguration: environment.p2p.rtcConfiguration,
            })
            window.wg = this.wg
            this.wg.onSignalingStateChange = (state) => this.serverConnectionStatusSubject.next(state)
            this.configureEncryption(environment.cryptography.type)
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

    //Sending data
    send (streamId: StreamId, content: Uint8Array, id?: number): void {
      if (this.members.length > 1) {
        const msg = Message.create({ type: streamId.type, subtype: streamId.subtype, content })
        if (id === undefined) {
          this.wg.send(Message.encode(msg).finish())
        } else {
          id = id === 0 ? this.randomMember() : id
          this.wg.sendTo(id, Message.encode(msg).finish())
        }
      }
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

    // Handle encryption
    configureEncryption (type: EncryptionType) {
      switch (type) {
        case EncryptionType.KEY_AGREEMENT_BD:
          this.configureKeyAgreementBDEncryption()
          break
        case EncryptionType.METADATA:
          this.configureMetaDataEncryption()
          break
        case EncryptionType.NONE:
          this.configureNoEncryption()
          break
        default:
          log.error('Unknown Encryption type: ', type)
      }
    }
    
    configureMetaDataEncryption() { 
        this.route.data.subscribe(({ doc }: { doc: Doc }) => {
        doc.onMetadataChanges
          .pipe(
            filter(({ isLocal, changedProperties }) => {
              return !isLocal && changedProperties.includes(Doc.CRYPTO_KEY)
            })
          )
          .subscribe(() => {
            ;(this.cryptoService.crypto as Symmetric).importKey(doc.cryptoKey)
          })
        })
      
        this.wg.onMemberJoin = (networkId) => {
          this.memberJoinSubject.next(networkId)
        } 
        this.wg.onMemberLeave = (networkId) => {
          this.memberLeaveSubject.next(networkId)
        }
        this.wg.onStateChange = (state: WebGroupState) => {
          const stateNumber = parseInt(state.toString(), 10) 
          this.connectionGroupStatusSubject.next(stateNumber)
          if (stateNumber === 1){
            this.connectionState.next(true)
          } else {
            this.connectionState.next(false)
          }
        } 
        this.wg.onMessage = (networkId, bytes: Uint8Array) => {
          try {
            const { type, subtype, content } = Message.decode(bytes)
            if (type === MuteCoreStreams.DOCUMENT_CONTENT) {
              this.cryptoService.crypto
                .decrypt(content)
                .then((decryptedContent) => {
                  this.messageReceived.next({ streamId: { type, subtype }, content: decryptedContent, senderNetworkId: networkId })
                })
                .catch((err) => {})
              return
            }
            this.messageReceived.next({ streamId: { type, subtype }, content, senderNetworkId: networkId })
          } catch (err) {
            log.warn('Message from network decode error: ', err.message)
          }
        }
        
      }

      configureKeyAgreementBDEncryption() {
        console.log("KeyAgreementBDEncryption")
        /*
        const bd = this.cryptoService.crypto as KeyAgreementBD
        if (environment.cryptography.coniksClient || environment.cryptography.keyserver) {
          bd.signingKey = this.cryptoService.signingKeyPair.privateKey
          this.cryptoService.onSignatureError = (id) => log.error('Signature verification error for ', id)
        }
        bd.onSend = (msg, streamId) => this.send({ type: streamId, subtype: StreamsSubtype.CRYPTO }, msg)
        // Handle network events
        this.wg.onMyId = (myId) => bd.setMyId(myId)
        this.wg.onMemberJoin = (networkId) => {
          bd.addMember(networkId)
          this.memberJoinSubject.next(networkId)
        }
        this.wg.onMemberLeave = (networkId) => {
          bd.removeMember(networkId)
          this.memberLeaveSubject.next(networkId)
        }
        this.wg.onStateChange = (state: WebGroupState) => {
          if (state === WebGroupState.JOINED) {
            bd.setReady()
          }
          this.stateSubject.next(state)
        }
        this.wg.onMessage = (networkId, bytes: Uint8Array) => {
          try {
            const { type, subtype, content } = Message.decode(bytes)
            if (type === MuteCryptoStreams.KEY_AGREEMENT_BD) {
              this.cryptoService.onBDMessage(networkId, content)
            } else {
              if (type === MuteCoreStreams.DOCUMENT_CONTENT) {
                this.cryptoService.crypto
                  .decrypt(content)
                  .then((decryptedContent) => {
                    this.messageSubject.next({ streamId: { type, subtype }, content: decryptedContent, senderNetworkId: networkId })
                  })
                  .catch((err) => {})
                return
              }
              this.messageSubject.next({ streamId: { type, subtype }, content, senderNetworkId: networkId })
            }
          } catch (err) {
            log.warn('Message from network decode error: ', err.message)
          }
        }*/
      }
    
      /**
       * Using this mode, no encryption is done on the data.
       * You also can't receive modification you weren't there to see on a document
       */
      configureNoEncryption() {
        console.log("NoEncryption")
        // Handle network events
        this.wg.onMemberJoin = (networkId) => this.memberJoinSubject.next(networkId)
        this.wg.onMemberLeave = (networkId) => this.memberLeaveSubject.next(networkId)
        this.wg.onStateChange = (state: WebGroupState) => {
          const stateNumber = parseInt(state.toString(), 10) 
          this.connectionGroupStatusSubject.next(stateNumber)
        } 
        this.wg.onMessage = (networkId, bytes: Uint8Array) => {
          try {
            const { type, subtype, content } = Message.decode(bytes)
            this.messageReceived.next({ streamId: { type, subtype }, content, senderNetworkId: networkId })
          } catch (err) {
            log.warn('Message from network decode error: ', err.message)
          }
        }
      }

}