import { animate, state, style, transition, trigger } from '@angular/animations'
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { NetworkServiceAbstracted } from '@app/doc/network/network.service.abstracted'

@Component({
  selector: 'mute-sync',
  templateUrl: './sync.component.html',
  styleUrls: ['./sync.component.scss'],
  animations: [
    trigger('cardState', [
      state(
        'visible',
        style({
          opacity: '1',
        })
      ),
      transition('void => visible', animate('150ms ease-out')),
      transition('visible => void', animate('150ms ease-in')),
    ]),
  ],
})
export class SyncComponent implements OnInit, OnDestroy {
  private subscriptions: Subscription[]

  public SYNC = 1
  public SYNC_DISABLED = 2

  public syncState: number
  public cardState: string
  public groupDetails: string
  public serverDetails: string

  public networkUseGroup: boolean
  public networkUseServer: boolean

  constructor(private changeDetectorRef: ChangeDetectorRef, private networkService: NetworkServiceAbstracted) {
    this.subscriptions = []
    this.groupDetails = ''
    this.serverDetails = ''
    this.networkUseGroup = networkService.useGroup
    this.networkUseServer = networkService.useServer
  }

  ngOnInit() {
    //Handling the status of connection to the group of peers
    this.subscriptions.push(
      this.networkService.onGroupConnectionStatusChange.subscribe((s: number) => {
        switch (s) {
          case this.networkService.groupConnectionStatus.values["JOINING"]:
            this.groupDetails = 'Trying to join the group...'
            this.syncState = undefined
            break
          case this.networkService.groupConnectionStatus.values["JOINED"]:
              this.groupDetails = 'Joined the group'
              this.syncState = this.SYNC
              break
          case this.networkService.groupConnectionStatus.values["OFFLINE"]:
            this.groupDetails = 'Not connected to the group'
            this.syncState = this.SYNC_DISABLED
            break
          default:
            this.groupDetails = 'Not connected to the group'
            this.syncState = undefined
        }
        this.changeDetectorRef.detectChanges()
      })
    )

    // Handling the status of connection to the signaling server, message queue...
    this.subscriptions.push(
      this.networkService.onServerConnectionStatusChange.subscribe((s: number) => {
        switch (s) {
          case this.networkService.serverConnectionStatus.values["CONNECTING"]:
            this.serverDetails = 'Connecting to the signaling server... '
            break
          case this.networkService.serverConnectionStatus.values["OPEN"]:
            this.serverDetails = 'Connected to the signaling server'
            break
          case this.networkService.serverConnectionStatus.values["CHECKING"]:
            this.serverDetails = 'Checking group membership'
            break
          case this.networkService.serverConnectionStatus.values["CHECKED"]:
            this.serverDetails = 'Signaling checked'
            break
          case this.networkService.serverConnectionStatus.values["CLOSED"]:
            this.serverDetails = 'No longer connected to the signaling server'
            break
          default:
            this.serverDetails = 'undefined'
        }
        this.changeDetectorRef.detectChanges()
      })
    )
  }

  ngOnDestroy() {
    this.subscriptions.forEach((sub) => sub.unsubscribe())
  }

  showCard() {
    this.cardState = 'visible'
  }

  hideCard() {
    this.cardState = 'void'
  }
}
