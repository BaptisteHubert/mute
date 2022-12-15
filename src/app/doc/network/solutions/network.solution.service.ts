import { EncryptionType } from "@app/core/crypto/EncryptionType.model";
import { StreamId } from "@coast-team/mute-core";
import { Subject } from "rxjs/internal/Subject";

// This interface represents a generic class that should handle the network functions of the mute project 
export interface INetworkSolutionService {

    myNetworkId : number
    neighbors: [number]
    
    connectionState: Subject<boolean>

    sendToAll : (message: Uint8Array)=> void

    sendRandom : (message: Uint8Array) => void

    sendTo : (recipientNetworkId : number, message: Uint8Array)=> void

    joinNetwork : (key : string) => void

    leaveNetwork : () => void

    send : (streamId: StreamId, content: Uint8Array, id?: number) => void

    useGroup : () => boolean

    useServer : () => boolean

    // Encryption logic
    configureEncryption : (type: EncryptionType) => void

    configureKeyAgreementBDEncryption : () => void
    
    configureMetaDataEncryption : () => void
    
    configureNoEncryption : () => void

}