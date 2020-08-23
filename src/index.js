'use strict'

const errcode = require('err-code')

const TCP = require('libp2p-tcp')
const { Request, Response } = require('libp2p-daemon/src/protocol')
const StreamHandler = require('libp2p-daemon/src/stream-handler')
const PeerID = require('peer-id')
const multiaddr = require('multiaddr')

const DHT = require('./dht')
const Pubsub = require('./pubsub')
const { passThroughUpgrader } = require('./util')

class Client {
  /**
   * @constructor
   * @param {Multiaddr} addr Multiaddr for the client to connect to
   */
  constructor (addr) {
    this.multiaddr = addr
    this.tcp = new TCP({ upgrader: passThroughUpgrader })

    this.dht = new DHT(this)
    this.pubsub = new Pubsub(this)
  }

  /**
   * Connects to a daemon at the unix socket path the daemon
   * was created with
   * @async
   * @returns {MultiaddrConnection}
   */
  connectDaemon () {
    return this.tcp.dial(this.multiaddr)
  }

  /**
   * Starts a server listening at `socketPath`. New connections
   * will be sent to the `connectionHandler`.
   * @param {Multiaddr} addr
   * @param {function(Stream)} connectionHandler
   * @returns {Promise}
   */
  async start (addr, connectionHandler) {
    if (this.listener) {
      await this.close()
    }

    this.listener = this.tcp.createListener(maConn => connectionHandler(maConn))

    await this.listener.listen(addr)
  }

  /**
   * Sends the request to the daemon and returns a stream. This
   * should only be used when sending daemon requests.
   * @param {Request} request A plain request object that will be protobuf encoded
   * @returns {StreamHandler}
   */
  async send (request) {
    const maConn = await this.connectDaemon()

    const streamHandler = new StreamHandler({ stream: maConn })
    streamHandler.write(Request.encode(request))
    return streamHandler
  }

  /**
   * Closes the socket
   * @returns {Promise}
   */
  async close () {
    this.listener && await this.listener.close()
    this.listener = null
  }

  /**
   * Connect requests a connection to a known peer on a given set of addresses
   * @param {PeerId} peerId
   * @param {Array.<multiaddr>} addrs
   */
  async connect (peerId, addrs) {
    if (!PeerID.isPeerId(peerId)) {
      throw errcode(new Error('invalid peer id received'), 'ERR_INVALID_PEER_ID')
    }

    if (!Array.isArray(addrs)) {
      throw errcode(new Error('addrs received are not in an array'), 'ERR_INVALID_ADDRS_TYPE')
    }

    addrs.forEach((addr) => {
      if (!multiaddr.isMultiaddr(addr)) {
        throw errcode(new Error('received an address that is not a multiaddr'), 'ERR_NO_MULTIADDR_RECEIVED')
      }
    })

    const sh = await this.send({
      type: Request.Type.CONNECT,
      connect: {
        peer: peerId.toBytes(),
        addrs: addrs.map((a) => a.bytes)
      }
    })

    const message = await sh.read()
    if (!message) {
      throw errcode(new Error('unspecified'), 'ERR_CONNECT_FAILED')
    }

    const response = Response.decode(message)
    if (response.type !== Response.Type.OK) {
      const errResponse = response.error || {}
      throw errcode(new Error(errResponse.msg || 'unspecified'), 'ERR_CONNECT_FAILED')
    }

    await sh.close()
  }

  /**
  * @typedef {Object} IdentifyResponse
  * @property {PeerId} peerId
  * @property {Array.<multiaddr>} addrs
  */

  /**
   * Identify queries the daemon for its peer ID and listen addresses.
   * @returns {IdentifyResponse}
   */
  async identify () {
    const sh = await this.send({
      type: Request.Type.IDENTIFY
    })

    const message = await sh.read()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_IDENTIFY_FAILED')
    }

    const peerId = PeerID.createFromBytes(response.identify.id)
    const addrs = response.identify.addrs.map((a) => multiaddr(a))

    await sh.close()

    return ({ peerId, addrs })
  }

  /**
   * Get a list of IDs of peers the node is connected to.
   * @returns {Array.<PeerId>}
   */
  async listPeers () {
    const sh = await this.send({
      type: Request.Type.LIST_PEERS
    })

    const message = await sh.read()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_LIST_PEERS_FAILED')
    }

    await sh.close()

    return response.peers.map((peer) => PeerID.createFromBytes(peer.id))
  }

  /**
   * Initiate an outbound stream to a peer on one of a set of protocols.
   * @param {PeerId} peerId
   * @param {string} protocol
   * @returns {Socket} socket
   */
  async openStream (peerId, protocol) {
    if (!PeerID.isPeerId(peerId)) {
      throw errcode(new Error('invalid peer id received'), 'ERR_INVALID_PEER_ID')
    }

    if (typeof protocol !== 'string') {
      throw errcode(new Error('invalid protocol received'), 'ERR_INVALID_PROTOCOL')
    }

    const sh = await this.send({
      type: Request.Type.STREAM_OPEN,
      streamOpen: {
        peer: peerId.toBytes(),
        proto: [protocol]
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      await sh.close()
      throw errcode(new Error(response.error.msg), 'ERR_OPEN_STREAM_FAILED')
    }

    return sh.rest()
  }

  /**
   * Register a handler for inbound streams on a given protocol
   *
   * @param {Multiaddr} addr
   * @param {string} protocol
   */
  async registerStreamHandler (addr, protocol) {
    if (!multiaddr.isMultiaddr(addr)) {
      throw errcode(new Error('invalid multiaddr received'), 'ERR_INVALID_MULTIADDR')
    }

    if (typeof protocol !== 'string') {
      throw errcode(new Error('invalid protocol received'), 'ERR_INVALID_PROTOCOL')
    }

    const sh = await this.send({
      type: Request.Type.STREAM_HANDLER,
      streamOpen: null,
      streamHandler: {
        addr: addr.bytes,
        proto: [protocol]
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    await sh.close()

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_REGISTER_STREAM_HANDLER_FAILED')
    }
  }
}

module.exports = Client
