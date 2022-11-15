# **Replacing the network layer of mute**

## **Curent network layer of MUTE**
For the network layer of MUTE, we are using software developed by the COAST Team.
MUTE currently uses [netflux](https://github.com/coast-team/netflux) to handle the peer to peer networking creation process.
For this process, a rendez-vous point server is needed. In our case, [sigver](https://github.com/coast-team/sigver) is used.

<br> 

### **Where are these referenced ?**
Netflux is principally referenced in the `mute-core` package.  
It is also referenced in the `mute` package, for its logging functions.

<br> 

#### **MUTE**

##### **Netflux involvement in MUTE**
Netflux :
- manage the connectivity between peers.
- creates the RTCDataChannel *(Sigver must be running for netflux to create the connection between peers)*.

Many objects are imported from netflux in mute.

`LogLevel` and `setLogLevel` objects serves to log what happens in the neflux components.

 `SignalingState`, `WebGroup` and `WebGroupState` are more important objects. Those objects are referenced in :
- `src/app/doc/network/network.service.ts` 
- `src/app/doc/doc.service.ts`
- `src/app/doc/toolbar/sync.component.ts`

`SignalingState` is used to get informations about the signaling event. When an user tries to join a document in mute, they will connect to sigver (the signaling server developed by the coast-team). When connected to this server, any peers that wants to join the document will also connect to the signaling server. 

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

Declared in `src/WebChannelFacade.ts`, `WebGroup` is used in mute in the `NetworkService` class. A webGroup is declared, using custom url for the signalingServer and the rtcConfiguration. 

`WebGroupState` is an object that represents the current state of the connection to the webGroup 
At the start, its value is `LEFT`. If the peer joins a WebGroup, his WebGroupState is at `JOINING`. When he finally joined the WebGroup, his WebGroupState values `JOINED`.


##### **Sigver involvement in MUTE**
The address where the Sigver server is accessible is referenced in the `environments` files *(depending on the context of the execution of the app)*.

The address is given in the `p2p` object, in the `signalingServer` attribute.

Other than that, there are configuration file to run sigver (docker files). 

Files to modify to account for the libp2p signaling server
- `.dockerignore`
- `docker-compose.yml`
- `DockerfileSigver`
- `process.yml`

However, it seems that the `@libp2p/webrtc-star-signalling-server@` package can't be used with pm2, with this error showing :

```
Error [ERR_REQUIRE_ESM]: require() of ES Module /usr/local/lib/node_modules/@libp2p/webrtc-star-signalling-server/bin/index.js not supported.
Instead change the require of index.js in null to a dynamic import() which is available in all CommonJS modules.
    at Object.<anonymous> (/usr/local/lib/node_modules/pm2/lib/ProcessContainerFork.js:33:23) {
  code: 'ERR_REQUIRE_ESM'
}
```

This error is coming from the fact that the libp2p-webrtc-star-signaling-server is using the old CommonJS way of importing modules *(using require())* in its code.

We fixed this error by referencing the index.js cited in the error message in the process declaration for pm2
(`/usr/local/lib/node_modules/@libp2p/webrtc-star-signalling-server/bin/index.js` instead of using `webrtc-star` directly)

##### **How to replace netflux and sigver usage in MUTE**


<br>

#### **MUTE-CORE**

In the MUTE-CORE project, there is the logic to use netflux and sigver.

##### **How to replace netflux and sigver usage in MUTE-CORE**


