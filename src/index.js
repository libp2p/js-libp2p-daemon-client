'use strict'

const net = require('net')
const Socket = net.Socket
const PeerID = require('peer-id')
const multiaddr = require('multiaddr')
const { encode, decode } = require('length-prefixed-stream')
const { Request, Response } = require('libp2p-daemon/src/protocol')
const errcode = require('err-code')

const DHT = require('./dht')
const Pubsub = require('./pubsub')
const { ends } = require('./util/iterator')
const { multiaddrToNetConfig } = require('./util')

const LIMIT = 1 << 22 // 4MB

class Client {
  /**
   * @constructor
   * @param {Multiaddr} addr Multiaddr for the client to connect to
   */
  constructor (addr) {
    this.multiaddr = addr
    this.server = null
    this.socket = new Socket({
      readable: true,
      writable: true,
      allowHalfOpen: true
    })
    this.socket.on('error', (_) => {
      this.close()
    })
    this.dht = new DHT(this)
    this.pubsub = new Pubsub(this)
  }

  /**
   * Connects to a daemon at the unix socket path the daemon
   * was created with
   * @returns {Promise}
   */
  attach () {
    return new Promise((resolve, reject) => {
      const options = multiaddrToNetConfig(this.multiaddr)
      this.socket.connect(options, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  /**
   * Starts a server listening at `socketPath`. New connections
   * will be sent to the `connectionHandler`.
   * @param {Multiaddr} addr
   * @param {function(Stream)} connectionHandler
   * @returns {Promise}
   */
  async startServer (addr, connectionHandler) {
    if (this.server) {
      await this.stopServer()
    }
    return new Promise((resolve, reject) => {
      this.server = net.createServer({
        allowHalfOpen: true
      }, connectionHandler)

      const options = multiaddrToNetConfig(addr)
      this.server.listen(options, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  }

  /**
   * Closes the net Server if it's running
   * @returns {Promise}
   */
  stopServer () {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => {
        this.server = null
        resolve()
      })
    })
  }

  /**
   * Closes the socket
   * @returns {Promise}
   */
  async close () {
    await this.stopServer()

    return new Promise((resolve) => {
      if (this.socket.destroyed) return resolve()
      this.socket.end(resolve)
    })
  }

  /**
   * Sends the request to the daemon and returns a stream. This
   * should only be used when sending daemon requests.
   * @param {Request} request A plain request object that will be protobuf encoded
   * @returns {Stream}
   */
  send (request) {
    // Decode and pipe the response
    const dec = decode({ limit: LIMIT, allowEmpty: true })
    this.socket.pipe(dec)

    // Encode and pipe the request
    const enc = encode()
    enc.write(Request.encode(request))
    enc.pipe(this.socket)

    return ends(dec)
  }

  /**
   * A convenience method for writing data to the socket. This
   * also returns the socket. This should be used when opening
   * a stream, in order to read data from the peer libp2p node.
   * @param {Buffer} data
   * @returns {Socket}
   */
  write (data) {
    this.socket.write(data)
    return this.socket
  }

  /**
   * Connect requests a connection to a known peer on a given set of addresses
   * @param {PeerId} peerId
   * @param {Array.<multiaddr>} addrs
   */
  async connect (peerId, addrs) {
    if (!PeerID.isPeerId(peerId)) {
      throw errcode('invalid peer id received', 'ERR_INVALID_PEER_ID')
    }

    if (!Array.isArray(addrs)) {
      throw errcode('addrs received are not in an array', 'ERR_INVALID_ADDRS_TYPE')
    }

    addrs.forEach((addr) => {
      if (!multiaddr.isMultiaddr(addr)) {
        throw errcode('received an address that is not a multiaddr', 'ERR_NO_MULTIADDR_RECEIVED')
      }
    })

    const request = {
      type: Request.Type.CONNECT,
      connect: {
        peer: peerId.toBytes(),
        addrs: addrs.map((a) => a.buffer)
      }
    }

    const message = await this.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(response.error.msg, 'ERR_CONNECT_FAILED')
    }
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
    const request = {
      type: Request.Type.IDENTIFY
    }

    const message = await this.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(response.error.msg, 'ERR_IDENTIFY_FAILED')
    }

    const peerId = PeerID.createFromBytes(response.identify.id)
    const addrs = response.identify.addrs.map((a) => multiaddr(a))

    return ({ peerId, addrs })
  }

  /**
   * Get a list of IDs of peers the node is connected to.
   * @returns {Array.<PeerId>}
   */
  async listPeers () {
    const request = {
      type: Request.Type.LIST_PEERS
    }

    const message = await this.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(response.error.msg, 'ERR_LIST_PEERS_FAILED')
    }

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
      throw errcode('invalid peer id received', 'ERR_INVALID_PEER_ID')
    }

    if (typeof protocol !== 'string') {
      throw errcode('invalid protocol received', 'ERR_INVALID_PROTOCOL')
    }

    const request = {
      type: Request.Type.STREAM_OPEN,
      streamOpen: {
        peer: Buffer.from(peerId.toB58String()),
        proto: [protocol]
      }
    }

    const message = await this.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(response.error.msg, 'ERR_OPEN_STREAM_FAILED')
    }

    return this.socket
  }

  /**
   * Register a handler for inbound streams on a given protocol
   *
   * @param {Multiaddr} addr
   * @param {string} protocol
   */
  async registerStreamHandler (addr, protocol) {
    if (!multiaddr.isMultiaddr(addr)) {
      throw errcode('invalid multiaddr received', 'ERR_INVALID_MULTIADDR')
    }

    if (typeof protocol !== 'string') {
      throw errcode('invalid protocol received', 'ERR_INVALID_PROTOCOL')
    }

    const request = {
      type: Request.Type.STREAM_HANDLER,
      streamOpen: null,
      streamHandler: {
        addr: addr.buffer,
        proto: [protocol]
      }
    }

    const message = await this.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(response.error.msg, 'ERR_REGISTER_STREAM_HANDLER_FAILED')
    }
  }
}

module.exports = Client
