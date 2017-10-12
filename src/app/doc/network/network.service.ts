import { Injectable } from '@angular/core'
import { BroadcastMessage, JoinEvent, NetworkMessage, SendRandomlyMessage, SendToMessage } from 'mute-core'
import { enableLog, SignalingState, WebGroup, WebGroupState } from 'netflux'
import { BehaviorSubject, Observable, Observer, ReplaySubject, Subject, Subscription } from 'rxjs/Rx'

import { environment } from '../../../environments/environment'
import { UiService } from '../../core/ui/ui.service'
import { WindowRefService } from '../../core/WindowRefService'
import { BotProtocol, BotResponse, Message } from './message_pb'

@Injectable()
export class NetworkService {

  public wg: WebGroup
  public key: string
  private botUrls: string[]

  private disposeSubject: Subject<void>

  // Subjects related to the current peer
  private joinSubject: Subject<JoinEvent>
  private leaveSubject: Subject<number>
  private lineSubject: BehaviorSubject<boolean>

  // Network message subject
  private messageSubject: ReplaySubject<NetworkMessage>

  /**
   * Peer Join/Leave subjects
   */
  private peerJoinSubject: ReplaySubject<number>
  private peerLeaveSubject: ReplaySubject<number>

  private messageToBroadcastSubscription: Subscription
  private messageToSendRandomlySubscription: Subscription
  private messageToSendToSubscription: Subscription

  // Connection state subject
  private stateSubject: Subject<WebGroupState>
  private signalingSubject: Subject<SignalingState>

  constructor (
    private windowRef: WindowRefService,
    private ui: UiService
  ) {
    this.botUrls = []
    this.key = ''

    // Initialize subjects
    this.peerJoinSubject = new ReplaySubject()
    this.peerLeaveSubject = new ReplaySubject()
    this.signalingSubject = new Subject()
    this.stateSubject = new Subject()
    this.messageSubject = new ReplaySubject()

    this.disposeSubject = new Subject<void>()
    this.lineSubject = new BehaviorSubject(this.windowRef.window.navigator.onLine)
    this.joinSubject = new Subject()
    this.leaveSubject = new Subject()

    // Configure Netflux logs
    enableLog(environment.netfluxLog)

    this.init()

    let goneOfflineOnce = !this.windowRef.window.navigator.onLine
    /**
     * Rejoin web group when some events fired some time later (see throttleTime method).
     * The rejoin delay is because sometimes may fire Online/Offline events several times
     * in a relatively short period of time.
     */
    Observable.create((observer: Observer<void>) => {
      this.windowRef.window.addEventListener('online', () => {
        if (this.ui.activeFile && ui.activeFile.isDoc) {
          log.info('network', 'Gone ONLINE')
          if (goneOfflineOnce) {
            observer.next(undefined)
            this.lineSubject.next(true)
          }
        }
      })
      this.windowRef.window.document.addEventListener('visibilitychange', () => {
        if (this.ui.activeFile && ui.activeFile.isDoc) {
          if (this.windowRef.window.document.visibilityState === 'visible') {
            observer.next(undefined)

          // Leave when the tab is hidden and there are nobody apart you in the web group
          } else if (this.windowRef.window.document.visibilityState === 'hidden' && this.wg.members.length === 1) {
            this.wg.leave()
          }
        }
      })
    }).throttleTime(1000)
      .subscribe(() => this.join(this.key))

    /**
     * Leave web group in some specific situations
     */
    // Leave before closing a tab or the browser
    this.windowRef.window.addEventListener('beforeunload', () => this.wg.leave())

    // Leave when gone Offline
    this.windowRef.window.addEventListener('offline', () => {
      log.info('network', 'Gone OFFLINE')
      goneOfflineOnce = true
      this.wg.leave()
      this.lineSubject.next(false)
    })
  }

  init (): void {
    this.wg = new WebGroup({
      signalingURL: environment.signalingURL,
      iceServers: environment.iceServers
    })
    this.windowRef.window.wg = this.wg

    // Handle network events
    this.wg.onMemberJoin = (id) => this.peerJoinSubject.next(id)
    this.wg.onMemberLeave = (id) => {
      this.peerLeaveSubject.next(id)
      // Leave web group when no other members in the group and the tab is not visible
      if (this.wg.members.length === 1 && document.visibilityState === 'hidden') {
        this.wg.leave()
      }
    }
    this.wg.onSignalingStateChange = (state: SignalingState) => {
      this.signalingSubject.next(state)
    }
    this.wg.onStateChange = (state: WebGroupState) => {
      if (state === WebGroupState.JOINED) {
        const joinEvt = new JoinEvent(this.wg.myId, this.key, this.members.length === 1)
        this.joinSubject.next(joinEvt)
      }
      this.stateSubject.next(state)
    }
    this.wg.onMessage = (id, bytes: Uint8Array, isBroadcast) => {
      const msg = Message.decode(bytes)
      const serviceName = msg.service
      if (serviceName === 'botprotocol') {
        const content = BotProtocol.create({key: this.key})
        const msg = Message.create({
          service: 'botprotocol',
          content: BotProtocol.encode(content).finish()
        })
        log.debug('Sending doc key to bot: ', this.key)
        this.wg.sendTo(id, Message.encode(msg).finish())
      } else if (serviceName === 'botresponse') {
        const url = BotResponse.decode(msg.content).url
        this.botUrls.push(url)
      } else {
        const networkMessage = new NetworkMessage(serviceName, id, isBroadcast, msg.content)
        this.messageSubject.next(networkMessage)
      }
    }
  }

  leave () {
    this.wg.leave()
  }

  set initSource (source: Observable<string>) {
    source.takeUntil(this.disposeSubject).subscribe((key: string) => {
      this.key = key
      log.debug('DOC KEY: ', key)
      this.join(key)
    })
  }

  set messageToBroadcastSource (source: Observable<BroadcastMessage>) {
    this.messageToBroadcastSubscription = source.subscribe((broadcastMessage: BroadcastMessage) => {
      this.send(broadcastMessage.service, broadcastMessage.content)
    })
  }

  set messageToSendRandomlySource (source: Observable<SendRandomlyMessage>) {
    this.messageToSendRandomlySubscription = source.subscribe((sendRandomlyMessage: SendRandomlyMessage) => {
      const otherMembers: number[] = this.members.filter((id: number) => id !== this.wg.myId)
      const index: number = Math.ceil(Math.random() * otherMembers.length) - 1
      const id: number = otherMembers[index]
      this.send(sendRandomlyMessage.service, sendRandomlyMessage.content, id)
    })
  }

  set messageToSendToSource (source: Observable<SendToMessage>) {
    this.messageToSendToSubscription = source.subscribe((sendToMessage: SendToMessage) => {
      this.send(sendToMessage.service, sendToMessage.content, sendToMessage.id)
    })
  }

  get myId (): number { return this.wg.myId }

  get members (): number[] { return this.wg.members }

  get onMessage (): Observable<NetworkMessage> { return this.messageSubject.asObservable() }

  get onJoin (): Observable<JoinEvent> { return this.joinSubject.asObservable() }

  get onLine (): Observable<boolean> { return this.lineSubject.asObservable() }

  get onLeave (): Observable<number> { return this.leaveSubject.asObservable() }

  get onPeerJoin (): Observable<number> { return this.peerJoinSubject.asObservable() }

  get onPeerLeave (): Observable<number> { return this.peerLeaveSubject.asObservable() }

  get onStateChange (): Observable<number> { return this.stateSubject.asObservable() }

  get onSignalingStateChange (): Observable<number> { return this.signalingSubject.asObservable() }

  clean (): void {
    if (this.wg !== undefined) {
      this.wg.leave()
      this.leaveSubject.next()

      this.disposeSubject.complete()
      this.messageSubject.complete()
      this.joinSubject.complete()
      this.leaveSubject.complete()
      this.peerJoinSubject.complete()
      this.peerLeaveSubject.complete()

      this.disposeSubject = new Subject<void>()
      this.messageSubject = new ReplaySubject<NetworkMessage>()
      this.joinSubject = new Subject()
      this.leaveSubject = new Subject()
      this.peerJoinSubject = new ReplaySubject<number>()
      this.peerLeaveSubject = new ReplaySubject<number>()

      this.messageToBroadcastSubscription.unsubscribe()
      this.messageToSendRandomlySubscription.unsubscribe()
      this.messageToSendToSubscription.unsubscribe()
    }
  }

  inviteBot (url: string): void {
    if (!this.botUrls.includes(url)) {
      const fullUrl = url.startsWith('ws') ? url : `ws://${url}`
      this.wg.invite(fullUrl)
    }
  }

  send (service: string, content:  Uint8Array, id?: number|undefined): void {
    const msg = Message.create({ service, content})
    if (id === undefined) {
      this.wg.send(Message.encode(msg).finish())
    } else {
      this.wg.sendTo(id, Message.encode(msg).finish())
    }
  }

  private join (key) {
    console.assert(key !== '')
    if (this.windowRef.window.navigator.onLine &&
        this.windowRef.window.document.visibilityState === 'visible' &&
       this.wg.state === WebGroupState.LEFT
    ) {
      this.wg.join(key)
    }
  }
}
