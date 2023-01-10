import { Strategy } from '@coast-team/mute-core'
import { LogLevel } from 'netflux'
import { EncryptionType } from '../app/core/crypto/EncryptionType.model'
import { networkSolution } from '@app/doc/network/solutions/networkSolution'

export interface IEnvironment {
  production: boolean

  crdtStrategy: Strategy

  network: networkSolution

  debug: {
    visible: boolean
    log: {
      netflux: LogLevel[]
      crypto: boolean
      doc: boolean
    }
  }

  p2p: {
    /**
     * We provide one by default: sigver
     */
    signalingServer: string

    libp2pAddr?: string
    

    /**
     * Parameters for the connection to the signaling server
     */
    rtcConfiguration?: RTCConfiguration
    
  }

  cryptography: {
    type: EncryptionType

    coniksClient?: {
      url: string
      binaries: {
        linux: string
        windows: string
        macOS: string
      }
    }

    keyserver?: {
      urlPrefix: string
    }
  }

  logSystem: {
    logCollectorUrl: string
    stompjsDebugLog: boolean
    anonimyze: boolean
  }

  botStorage?: {
    httpURL: string
    wsURL: string
    isAnonymousAllowed: boolean
  }

  authentication?: {
    baseUrl: string
    providers: {
      github: {
        clientId: string
        scope: [string]
      }
      google: {
        clientId: string
        scope: [string, string]
      }
    }
  }

  pulsar: {
    wsURL: string
  }
}
