import { EncryptionType } from "@app/core/crypto/EncryptionType.model";
import { StreamId } from "@coast-team/mute-core";
import { Libp2p } from "libp2p/dist/src";
import { Subject } from "rxjs/internal/Subject";

// This interface represents a generic class that should handle the network functions of the mute project 
export interface INetworkSolutionService {

    myNetworkId : Subject<number>
    peers : number[]
    neighbors: number[]
    
    connectionState: Subject<boolean>

    send : (streamId: StreamId, content: Uint8Array, peers : number[], id?: number) => void

    sendToAll : (message: Uint8Array)=> void

    sendRandom : (message: Uint8Array) => void

    sendTo : (recipientNetworkId : number, message: Uint8Array)=> void

    joinNetwork : (key : string) => void

    leaveNetwork : () => void

    //send : (streamId: StreamId, content: Uint8Array, id?: number) => void

    useGroup : () => boolean

    useServer : () => boolean

    configureNetworkBehavior : (libp2pInstance? :Libp2p) => void
}