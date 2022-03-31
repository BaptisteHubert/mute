import { ChangeDetectorRef, Injectable, OnDestroy } from '@angular/core'
import { merge, Observable, Subject, Subscription } from 'rxjs'
import { filter, map } from 'rxjs/operators'

import { ICollaborator } from '@coast-team/mute-core'

import { EProperties } from '@app/core/settings/EProperties.enum'
import {
  Profile,
  SettingsService
} from '@app/core/settings'

import { Colors } from './Colors'
import { RichCollaborator } from './RichCollaborator'
import { promise } from 'protractor'
import { collaborator } from '@coast-team/mute-core/dist/types/src/proto'
import { CollaboratorsService } from '@coast-team/mute-core/dist/types/src/collaborators'

@Injectable()
export class RichCollaboratorsService implements OnDestroy {
  private joinSubject: Subject<RichCollaborator>
  private leaveSubject: Subject<number>
  private updateSubject: Subject<RichCollaborator>
  private me: Promise<void>
  private colors: Colors
  private subs: Subscription[]

  private myDeviceId: string

  public collaborators: RichCollaborator[]

  constructor(cd: ChangeDetectorRef, settings: SettingsService) {
    this.joinSubject = new Subject()
    this.leaveSubject = new Subject()
    this.updateSubject = new Subject()
    this.colors = new Colors()
    this.subs = []
    
    let me = this.createMe(settings.profile)
    this.myDeviceId = me.deviceID
    this.collaborators = [me]
    this.me = Promise.resolve()
    this.subs.push(
      settings.onChange
        .pipe(filter((props) => props.includes(EProperties.profile) || props.includes(EProperties.profileDisplayName)))
        .subscribe((props) => {
          const index = this.collaborators.indexOf(me)
          if (props.includes(EProperties.profile)) {
            me = this.createMe(settings.profile)
          } else {
            me.displayName = settings.profile.displayName
          }
          this.collaborators[index] = me
          this.updateSubject.next(me)
        })
    )

    this.subs[this.subs.length] = this.onChanges.subscribe(() => cd.detectChanges())
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe())
  }

  get onUpdate(): Observable<RichCollaborator> {
    return this.updateSubject.asObservable()
  }

  get onJoin(): Observable<RichCollaborator> {
    return this.joinSubject.asObservable()
  }

  get onLeave(): Observable<number> {
    return this.leaveSubject.asObservable()
  }

  get onChanges(): Observable<void> {
    return merge(this.updateSubject, this.joinSubject, this.leaveSubject, this.me).pipe(map(() => undefined))
  }

  subscribeToUpdateSource(source: Observable<ICollaborator>) {
    this.subs.push(
      source.subscribe((collab: ICollaborator) => {
        for (const c of this.collaborators) {
          if (collab.id === c.id) {
            c.update(collab)
            this.updateSubject.next(c)
            break
          }
        }
      })
    )
  }

  /**
   * Handles ICollaborator joining the document
   */
  subscribeToJoinSource(source: Observable<ICollaborator>) {
    this.subs.push(
      source.subscribe((collab) => {
        let index = this.collaborators.findIndex((c) => c.deviceID === collab.deviceID)
        // If the ICollaborator joining isn't the same as the me user
        if (index == -1){
          const rc = new RichCollaborator(collab, this.colors.pick())
          index = this.collaborators.length
          this.collaborators[index] = rc
          this.joinSubject.next(rc)
        } else {
          this.collaborators[index].id =  collab.id
        }
      })
    )
  }


  /**
   * handles ICollaborator leaving the document
   */
  subscribeToLeaveSource(source: Observable<ICollaborator>) {
    this.subs.push(
      source.subscribe((collaborator: ICollaborator) => {
        console.log("Collaborator ", collaborator.id, " leaving the document")
        const index = this.collaborators.findIndex((c) => c.id === collaborator.id)
        this.colors.dismiss(this.collaborators[index].color)
        this.collaborators.splice(index, 1)
        this.leaveSubject.next(collaborator.id)
      })
    )
  }

  /**
   * Show current collaborators in this.collaborators
   */
  showCurrentMuteCollaborators():void{
    this.collaborators.forEach(element => 
      console.log("Collaborator id : ", element.id)
      )
  }

  private createMe(profile: Profile): RichCollaborator {
    return new RichCollaborator(
      {
        id: -1,
        login: profile.login,
        displayName: profile.displayName,
        deviceID: profile.deviceID,
        email: profile.email,
        avatar: profile.avatar,
      },
      this.colors.pick()
    )
  }
}
