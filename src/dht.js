'use strict'

const CID = require('cids')
const PeerID = require('peer-id')
const PeerInfo = require('peer-info')
const multiaddr = require('multiaddr')
const errcode = require('err-code')

const {
  Request,
  Response,
  DHTRequest,
  DHTResponse
} = require('libp2p-daemon/src/protocol')

class DHT {
  /**
   * @constructor
   * @param {Client} client libp2p daemon client instance
   */
  constructor (client) {
    this._client = client
  }

  /**
   * Write a value to a key in the DHT.
   * @param {String} key
   * @param {Buffer} value
   */
  async put (key, value) {
    if (typeof key !== 'string') {
      throw errcode(new Error('invalid key received'), 'ERR_INVALID_KEY')
    }

    if (!Buffer.isBuffer(value)) {
      throw errcode(new Error('value received is not a buffer'), 'ERR_INVALID_VALUE')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.PUT_VALUE,
        key,
        value
      }
    }

    const message = await this._client.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_PUT_FAILED')
    }
  }

  /**
   * Query the DHT for a value stored at a key in the DHT.
   * @param {String} key
   * @returns {Buffer}
   */
  async get (key) {
    if (typeof key !== 'string') {
      throw errcode(new Error('invalid key received'), 'ERR_INVALID_KEY')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_VALUE,
        key
      }
    }

    const message = await this._client.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_GET_FAILED')
    }

    return response.dht.value
  }

  /**
   * Query the DHT for a given peer's known addresses.
   * @param {PeerId} peerId
   * @returns {PeerInfo}
   */
  async findPeer (peerId) {
    if (!PeerID.isPeerId(peerId)) {
      throw errcode(new Error('invalid peer id received'), 'ERR_INVALID_PEER_ID')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.FIND_PEER,
        peer: peerId.toBytes()
      }
    }

    const message = await this._client.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_FIND_PEER_FAILED')
    }

    const receivedPeerId = PeerID.createFromBytes(response.dht.peer.id)
    const peerInfo = new PeerInfo(receivedPeerId)

    response.dht.peer.addrs.forEach((addr) => {
      const ma = multiaddr(addr)

      peerInfo.multiaddrs.add(ma)
    })

    return peerInfo
  }

  /**
   * Announce to the network that the peer have data addressed by the provided CID
   * @param {CID} cid
   */
  async provide (cid) {
    if (!CID.isCID(cid)) {
      throw errcode(new Error('invalid cid received'), 'ERR_INVALID_CID')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.PROVIDE,
        cid: cid.buffer
      }
    }

    const message = await this._client.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_PROVIDE_FAILED')
    }
  }

  /**
   * Query the DHT for peers that have a piece of content, identified by a CID.
   * @param {CID} cid
   * @param {number} count number or results to include (default: 1)
   * @returns {Array<PeerInfo>}
   */
  async * findProviders (cid, count = 1) {
    if (!CID.isCID(cid)) {
      throw errcode(new Error('invalid cid received'), 'ERR_INVALID_CID')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.FIND_PROVIDERS,
        cid: cid.buffer,
        count
      }
    }

    const stream = this._client.send(request)
    let response
    let started = false

    // message stream
    for await (const message of stream) {
      if (!started) {
        // stream begin message
        response = Response.decode(message)

        if (response.type !== Response.Type.OK) {
          stream.end()
          throw errcode(new Error(response.error.msg), 'ERR_DHT_FIND_PROVIDERS_FAILED')
        }
        started = true
      } else {
        response = DHTResponse.decode(message)

        // Stream end
        if (response.type === DHTResponse.Type.END) {
          stream.end()
          return
        }

        // Stream values
        if (response.type === DHTResponse.Type.VALUE) {
          const peerId = PeerID.createFromBytes(response.peer.id)
          const peerInfo = new PeerInfo(peerId)

          response.peer.addrs.forEach((addr) => {
            const ma = multiaddr(addr)

            peerInfo.multiaddrs.add(ma)
          })

          yield peerInfo
        } else {
          // Unexpected message received
          stream.end()
          throw errcode(new Error('unexpected message received'), 'ERR_UNEXPECTED_MESSAGE_RECEIVED')
        }
      }
    }
  }

  /**
   * Query the DHT routing table for peers that are closest to a provided key.
   * @param {string} key
   * @returns {Array<PeerInfo>}
   */
  async * getClosestPeers (key) {
    if (typeof key !== 'string') {
      throw errcode(new Error('invalid key received'), 'ERR_INVALID_KEY')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_CLOSEST_PEERS,
        key
      }
    }

    const stream = this._client.send(request)

    // stream begin message
    const message = await stream.first()
    let response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      stream.end()
      throw errcode(new Error(response.error.msg), 'ERR_DHT_FIND_PROVIDERS_FAILED')
    }

    for await (const message of stream) {
      response = DHTResponse.decode(message)

      // Stream end
      if (response.type === DHTResponse.Type.END) {
        stream.end()
        return
      }

      // Stream values
      if (response.type === DHTResponse.Type.VALUE) {
        const peerId = PeerID.createFromBytes(response.value)

        yield new PeerInfo(peerId)
      } else {
        // Unexpected message received
        throw errcode(new Error('unexpected message received'), 'ERR_UNEXPECTED_MESSAGE_RECEIVED')
      }
    }
  }

  /**
   * Query the DHT routing table for a given peer's public key.
   * @param {PeerId} peerId
   * @returns {PublicKey}
   */
  async getPublicKey (peerId) {
    if (!PeerID.isPeerId(peerId)) {
      throw errcode(new Error('invalid peer id received'), 'ERR_INVALID_PEER_ID')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_PUBLIC_KEY,
        peer: peerId.toBytes()
      }
    }

    const message = await this._client.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_GET_PUBLIC_KEY_FAILED')
    }

    return response.dht.value
  }
}

module.exports = DHT
