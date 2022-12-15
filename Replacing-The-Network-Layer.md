# **Replacing the network layer of mute**

## **Curent network layer of MUTE**

For the network layer of MUTE, we are using software developed by the COAST Team.
MUTE currently uses [netflux](https://github.com/coast-team/netflux) to handle the peer to peer networking creation process.
For this process, a rendez-vous point server is needed. In our case, [sigver](https://github.com/coast-team/sigver) is used.

<br> 

### **Where are these referenced ?**
Netflux is principally referenced in the `mute-core` package.  
It is also referenced in the `mute` package, for its logging functions.

Removing netflux should be done in multiple steps :

1. Creation of a mapping table between the id of peer used in mute, and the id of peer used in mute-core.
2. Abstraction of the `network.service.ts` class  
  2.1. Study of the requirements for the network to be abstracted
  2.2. What is happening right now in mute with netflux.
  2.3. Modification of the current netflux integration in the code
  2.4. Implement pulsar
3. Finalize SWIM integration to have the collaborators listing handled in mute-core

## 1. Mapping table between Mute and Mute-Core

Currently, there is a problem with identifiers used for the peers.

- The `Network` Id :

The id used across the `network.service.ts` class. This identifier is just called id in the code. However, this id is generated in the `Netflux` code. In this part of the project, it is even referenced as `NetfluxId`. 
We need to change this id and rename it to something that give more information about its goal. This identifier should convey the information that this id corresponds to the id of the peer on the network. Joining a group, sending a message, all these functions would use the identifier. Its name should be **`networkId`**.

##### **Netflux involvement in MUTE**
Netflux :
- manage the connectivity between peers.
- creates the RTCDataChannel *(Sigver must be running for netflux to create the connection between peers)*.
- The `MuteCore` Id :

There are two identifier for a peer in the `MuteCore` code. `id`, and `muteCoreId`. There is a confusion between the two as the first identifier doesn't seem to be important to the well being of the app. For this part, the muteCore identifier already exists. We should just get rid of the `id` identifier and, consequently, fix what is broken.

After this, we will create a map that links the `networkId` of a peer to its `muteCoreId` *(and inversely)*. This way, we will be able to use both id in the code more easily.

### Work done

In the **mute-core** project :  
We removed the id attribute in the `ICollaborator` interface. In the `EmitUpdate` function in the `CollaboratorsService` class, we removed the id as it is no longer used.  
We modified the names of the variable `senderId` and `recipientId` as `senderNetworkId` and `recipientNetworkId` to clearly states that it is the `networkId` used in the network part of mute.  
The networkId is now only stored as a key in the `collaborators` map in the `CollaboratorsService` class. (As opposed to before when it was basically both the id of the `ICollaborator` and the key to the `collaborators` map)  

In the **mute** project :

- `network.service.ts`
  
Created an `IdMap` class, that stores two maps, `networkIdToMuteCoreIdMap` and `muteCoreIdToNetworkIdMap`. With function to set and unset value to both of the maps, and getters.  
The `IdMap` is initialized in the `Network.service.ts` class.  
There is also a `tempNetworkId` cariable in the `network.service.ts` class.

- `rich-collaborators.service.ts`

Replaced the `id` by a `networkId`. In the constructor, added a parameter to get the `networkId`.  
Replaced every instance of the `id` of a `RichCollaborator`  by `networkId`.  
Replaced every instance of `senderId` and `recipientId` by `senderNetworkId` and `recipientNetworkId` *(to be on-par with what's used in mute-core)*  
Added a `NetworkService` class variable. This way, the IdMap is accessible. The network is set in the `doc.service.ts` class, before setting up the collaborator's subscriptions.  

The `RichCollaborator`, the collaborator used in mute, has a `networkId` attribute, whereas the `ICollaborator`, the collaborator used in mute-core has a `muteCoreId` attribute)  

Setting values in the IdMap is done by this process :
In the `doc.service` class. a subscription is made on the `network.onMemberJoin` observable. Whenever this observable is updated, we update the `network.tempNetworkId` by the value updated *(this observable is updated everytime a peer joins the webgroup in netflux)*.
In the `rich-collaborators.service` class, we can get the `ICollaborator.muteCoreId`. We get it in the `subscribeTo` class has these function use muteCore observable.

## 2. Abstraction of the `network.service.ts` class

Basically, we need to have a network service that could be plugged in with various solutions.
This abstracted service should replace the current network service, where the old logic and ties to neflux will be adapted in `netflux-service.ts` file type.

### 2.1. Study of the requirements for the network to be abstracted

What should be the core features of the networking capabilities of mute :

- Initializing the connection to other peers
  - Directly : Connecting to a signaling server, used for WebRTC communication
  - Indirectly : a server, a message queue
- Sending a message
  - To all the peers
  - To a specific peer
  - To random peers
- Receiving a message

The additional services that will come and be plugged in the new network service will handle the logic behind the peers connection.

**Other general things to note :**

- We are using RTCDataChannel as Channels for peers to communicate text data
- The peers ID are already used as numbers
- The id of a peer is generated in `WebChannel.ts.init.this.myId`

### 2.2. What is happening right now in mute with netflux

### **netflux involvement in MUTE**

#### **Code link between netflux and mute**

Many objects are imported from netflux in mute.

`LogLevel` and `setLogLevel` objects serves to log what happens in the neflux components.

 `SignalingState`, `WebGroup` and `WebGroupState` are more important objects. Those objects are referenced in :

- `src/app/doc/network/network.service.ts`
- `src/app/doc/doc.service.ts`
- `src/app/doc/toolbar/sync.component.ts`

#### **`SignalingState`**

The `SignalingState` is used to get informations about the signaling event. When an user tries to join a document in mute, they will connect to sigver (the signaling server developed by the coast-team).
When connected to this server, any peers that wants to join the document will also connect to the signaling server.  
The signaling server is a websocket server. When peers are connecting to it, they will go through some steps :

- Opening connection on the websocket
- Sending an heartbeat message to the websocket. Like a ping
- The websocket should receive the ping and respond with a pong
- The peer is connected to the websocket
- The peer is connected either to another peer or he's the only group member.
The SignalingState basically tells us in which step of connecting to the signaling server we are.

`WebGroup` is an object that has two primary objectives :

- Storing different variables about the peers that are connected on the document. These variables include the members, the current neighbors one peer has, the signalingState..
- Being an API starting point, the WebGroup also lets us chooses options (which signaling server url to use, what we want to do when an event happens on the WebGroup)

The webgroup object is defined in `src/WebChannelFacade.ts` in the `Netflux` code. A webGroup has many attributes :

- The WebGroup identifier
- The unique member of the current user in the WebGroup (`myId`)
- A key for joining the Signaling Server
- The members of the WebGroup
- The neighbors members
- The typology used
- The state of the WebGroup *(see WebGroupState below)*
- The signaling state *(see SignalingState above)*
- The URL for a signaling server
- A boolean setting up the auto rejoin feature

The Webgroup also uses handler called for different type of actions on the WebGroup :

- onMessage : when a message is received from the group
- onMyId : when the id of the current user is set
- onMemberJoin
- onMemberLeave
- onStateChange
- onSignalingStateChange

The WebGroup also provides functions to :

- join a group
- invite a bot server to join the group
- leave the group
- send a message to the group
- send a message to a particular group member

#### **`WebGroupState`**

`WebGroupState` is an object that represents the current state of the connection to the webGroup  
At the start, its value is `LEFT`. If the peer joins a WebGroup, his WebGroupState is at `JOINING`. When he finally joined the WebGroup, his WebGroupState has the `JOINED` value.

### 2.3. Modification of the current netflux integration in the code

SignalingState is used in `network.service.ts` and `sync.component.ts`.

WebGroup are used both in `doc.service.ts`, `network.service.ts`, `sync.component.ts`. 

But to replace the network layer, we need to know the exact process of creating the peer to peer network whenever a new document is created. We will also need to see how the data exchange *(cursor position, title of the document, text added to the doc, text deleted, text selected...)*

Once the logic behind this process is documented well enough, we will be able to replace it with libp2p.

`MUTE - network.service.ts` :
  
- **Webgroup** is created in the constructor. Members Subjects are created. - `this.wg = new WebGroup({*using environment variables for signaling and RTC Configuration*})`
- **configureEncryption()** is called, setting up the topology with FullMesh encryption - `this.configureEncryption(environment.cryptography.type)`
  - **encryptionType.METADATA** is used.
  - **configureMetaDataEncryption()** is called
    - Events on the webgroup member are being handled :
      - When someone joins the webgroup, the `memberJoinSubject` object is updated with the id of the peer joining the webgroup
      - When someone leaves the webgroup, the `memberLeaveSubject` object is updated with the id of the peer joining the webgroup

|  
|  
`MUTE - doc.service.ts` :

- **doc.service** is created. 
  - In the `app.routing.module.ts` file, when there is a key in the url, the DocResolverService class is called, creating a `DocService` object
  - As the document is opened, the `doc.component.html` file is used. In this file, there is a `mute-editor` component. It has a `(isReady)` attributes. 
    - This attributes points to a class variable in `editor.component.ts` (of `eventEmitter` type).
      - At the end of the `ngOnInit()` function, the attributes is setup with this code : `this.isReady.next()` 
    - `editorReady()` from `doc.component.ts` is called
- The `joinSession()` function is triggered
  - a `muteCore` instance is created with various options.
  - Subscription to muteCore text operations is done *(local and remote)*.
  - The `muteCore.messageIn$` is set to `mute.network.messageOut`
  - The `muteCore.messageOut$` is used as a source for the `mute.network.setMessageIn()` function
  - Subscription to muteCore Metadata change is done *(local and remote)*.
  - Collaborator's subscription are setup : 
    - The lines impacting `this.collabs` are here to make sure the collaborator events are shown :
    - **`collabs`** - `object` - *`Mute.RichCollaboratorsService.ts`*
      - The collaborators in the DocService. They subscribe to the `muteCore.collabJoin` observable.
    - **`muteCore.collabJoin`** - `function` - `MuteCore.ts`
      - Returns the `muteCore CollaboratorsService joinSubject` observable

    - **`muteCore.memberJoin`** - `function` - `MuteCore.ts`
      - Sets up `mute network.onMemberJoin()` as the source for the `muteCore.CollaboratorsService.memberJoin$` function.
        - `network.onMemberJoin()` returns the `memberJoinSubject` from the `network.service`

- The `join` function from the `network.service.ts` class is called with the document signalingKey
  - `doc.signalingKey` equals the document URL title
  - The `join()` function from the WebGroup is called with the document signaling key.  

**Creating an abstract network.service class**
After analysing the code, and the link between netflux and mute, we came to the conclusion that it was possible to create a new `NetworkServiceAbstracted ` class.
This class would serve as a link between the mute code *(as a whole)* and the solution used as the network layer *(wether it is netflux, libp2p, another solution)*

The first step in the removal of the *hard-coded* link to netflux in the mute code. There as been a replacement of the occurence where the original `NetworkService` was referenced.

**Adapting code**
To adapt the different solutions that we might use in the future, an interface has been used : `network.solution.service`
This interface lists what is the key features of the solution we will be using. Sending data, joining a network...
Then, the solution we use are adapted to fit the functions and the variables defined in the interface aforementioned.

**Adding function**
One interesting function that was thought over was the ability to leave the network by user-action. Before, for testing purpose, we were cutting the signaling server down to test the behavior of the app when offline. Now, there is an added button in the details section where you can leave/join depending on the state of your current connection.

### **Sigver involvement in MUTE**

The address where the Sigver server is accessible is referenced in the `environments` files *(depending on the context of the execution of the app)*.

The address is given in the `p2p` object, in the `signalingServer` attribute.

Other than that, there are configuration file to run sigver (docker files).

#### **How to abstract sigver usage in MUTE**

Files to modify to account for the libp2p signaling server

- `.dockerignore`
- `docker-compose.yml`
- `DockerfileSigver`
- `process.yml`

However, there is not a complex link to sigver in mute. Apart, from a `npm run sigver` in a prestart script in the `package.json` file, removing sigver from the code is quite easy.

##### Using the libp2p signaling server

However, it seems that the `@libp2p/webrtc-star-signalling-server@` package can't be used with pm2, with this error showing :

```text
Error [ERR_REQUIRE_ESM]: require() of ES Module /usr/local/lib/node_modules/@libp2p/webrtc-star-signalling-server/bin/index.js not supported.
Instead change the require of index.js in null to a dynamic import() which is available in all CommonJS modules.
    at Object.<anonymous> (/usr/local/lib/node_modules/pm2/lib/ProcessContainerFork.js:33:23) {
  code: 'ERR_REQUIRE_ESM'
}
```

This error is coming from the fact that the libp2p-webrtc-star-signaling-server is using the old CommonJS way of importing modules *(using require())* in its code.

We fixed this error by referencing the index.js cited in the error message in the process declaration for pm2
(`/usr/local/lib/node_modules/@libp2p/webrtc-star-signalling-server/bin/index.js` instead of using `webrtc-star` directly)


To prove that the network service has been succesfully abstracted, we should implement pulsar as another solution. Being able to use it by only setting it up in the environment variable would be interesting. It would also serves as a good way of dceoupling pulsar from the code and keep it all tidy in one place.
#### **MUTE-CORE**

In the MUTE-CORE project, there is the logic to use netflux and sigver.

##### **How to replace netflux and sigver usage in MUTE-CORE**


## 3. Finalize SWIM integration to have the collaborators listing handled in mute-core

Netflux is a package that proposes a lot of features. For example, it handles the collaborators "movement". Meaning, when someone leave the group, mute is updated to show the correct list of peers in the UI. This feature might not be part of the future P2P network solutions we might implement.
The solution for this is to delegate the collaborator leaving / joining / idling in the `mute-core` package. This way, we won't be dependent on the features of the P2P solutions. 
To delegate this task, we will be using the SWIM *(Scalable Weakly Consistent Infection-style Process Group Membership)* protocol.

### State of the current SWIM integration

There is already an implementation done in the `mute-core` code. But it needs some fixes.

## TO-DO list

What is left to do ?

- [x] Creating an interface for the networks solutions
- Implementing network solutions
  - [x] Netflux
  - [ ] Libp2p
  - [ ] Pulsar
- [ ] Move the cryptography functions away from the network services
- [ ] Move the logic behind handling peers connectivity in MUTE-CORE (using SWIM)
- [ ] Use multiple network solutions at once
- Fix various bugs
  - [ ] Incorrect profile picture is shown when hovering peers connected.
  - [ ] Digest is empty when joining a document (even if the document is not empty)
