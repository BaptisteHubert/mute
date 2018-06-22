import { Injectable } from '@angular/core'
import { BehaviorSubject, Observable, ReplaySubject, Subject } from 'rxjs'

@Injectable()
export class UiService {
  private docDigestSubject: Subject<number>
  private docNavToggleSubject: Subject<void>
  private navToggleSubject: Subject<void>

  public appUpdate: ReplaySubject<{ version: string; commit: string }>
  public appInstall: BehaviorSubject<boolean>
  public appInstallEvent: Event
  public click: Subject<void>
  public docTree: string

  constructor() {
    this.docDigestSubject = new Subject()
    this.navToggleSubject = new Subject()
    this.docNavToggleSubject = new Subject()
    this.appUpdate = new ReplaySubject()
    this.appInstall = new BehaviorSubject(false)
    this.click = new Subject()
    this.docTree = ''
  }

  get onNavToggle(): Observable<void> {
    return this.navToggleSubject.asObservable()
  }

  toggleNav(): void {
    this.navToggleSubject.next()
  }

  get onDocNavToggle(): Observable<void> {
    return this.docNavToggleSubject.asObservable()
  }

  get docDigest(): Observable<number> {
    return this.docDigestSubject.asObservable()
  }

  updateDocDigest(digest: number) {
    this.docDigestSubject.next(digest)
  }

  updateDocTree(value: string) {
    this.docTree = value
  }
}
