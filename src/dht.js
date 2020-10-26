'use strict'

const CID = require('cids')
const PeerID = require('peer-id')
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
   * @class
   * @param {Client} client - libp2p daemon client instance
   */
  constructor (client) {
    this._client = client
  }

  /**
   * Write a value to a key in the DHT.
   *
   * @param {Uint8Array} key
   * @param {Uint8Array} value
   */
  async put (key, value) {
    if (!(key instanceof Uint8Array)) {
      throw errcode(new Error('invalid key received'), 'ERR_INVALID_KEY')
    }

    if (!(value instanceof Uint8Array)) {
      throw errcode(new Error('value received is not a Uint8Array'), 'ERR_INVALID_VALUE')
    }

    const sh = await this._client.send({
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.PUT_VALUE,
        key,
        value
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    await sh.close()

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_PUT_FAILED')
    }
  }

  /**
   * Query the DHT for a value stored at a key in the DHT.
   *
   * @param {Uint8Array} key
   * @returns {Uint8Array}
   */
  async get (key) {
    if (!(key instanceof Uint8Array)) {
      throw errcode(new Error('invalid key received'), 'ERR_INVALID_KEY')
    }

    const sh = await this._client.send({
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_VALUE,
        key
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    await sh.close()

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_GET_FAILED')
    }

    return response.dht.value
  }

  /**
   * Query the DHT for a given peer's known addresses.
   *
   * @param {PeerId} peerId
   * @returns {PeerInfo}
   */
  async findPeer (peerId) {
    if (!PeerID.isPeerId(peerId)) {
      throw errcode(new Error('invalid peer id received'), 'ERR_INVALID_PEER_ID')
    }

    const sh = await this._client.send({
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.FIND_PEER,
        peer: peerId.toBytes()
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    await sh.close()

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_FIND_PEER_FAILED')
    }

    return {
      id: PeerID.createFromBytes(response.dht.peer.id),
      addrs: response.dht.peer.addrs.map((a) => multiaddr(a))
    }
  }

  /**
   * Announce to the network that the peer have data addressed by the provided CID
   *
   * @param {CID} cid
   */
  async provide (cid) {
    if (!CID.isCID(cid)) {
      throw errcode(new Error('invalid cid received'), 'ERR_INVALID_CID')
    }

    const sh = await this._client.send({
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.PROVIDE,
        cid: cid.bytes
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    await sh.close()

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_PROVIDE_FAILED')
    }
  }

  /**
   * Query the DHT for peers that have a piece of content, identified by a CID.
   *
   * @param {CID} cid
   * @param {number} count - number or results to include (default: 1)
   * @returns {Array<PeerInfo>}
   */
  async * findProviders (cid, count = 1) {
    if (!CID.isCID(cid)) {
      throw errcode(new Error('invalid cid received'), 'ERR_INVALID_CID')
    }

    const sh = await this._client.send({
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.FIND_PROVIDERS,
        cid: cid.bytes,
        count
      }
    })

    let message = await sh.read()

    // stream begin message
    let response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      await sh.close()
      throw errcode(new Error(response.error.msg), 'ERR_DHT_FIND_PROVIDERS_FAILED')
    }

    while (true) {
      message = await sh.read()
      response = DHTResponse.decode(message)

      // Stream end
      if (response.type === DHTResponse.Type.END) {
        await sh.close()
        return
      }

      // Stream values
      if (response.type === DHTResponse.Type.VALUE) {
        yield {
          id: PeerID.createFromBytes(response.peer.id),
          addrs: response.peer.addrs.map((a) => multiaddr(a))
        }
      } else {
        // Unexpected message received
        await sh.close()
        throw errcode(new Error('unexpected message received'), 'ERR_UNEXPECTED_MESSAGE_RECEIVED')
      }
    }
  }

  /**
   * Query the DHT routing table for peers that are closest to a provided key.
   *
   * @param {Uint8Array} key
   * @returns {Array<PeerInfo>}
   */
  async * getClosestPeers (key) {
    if (!(key instanceof Uint8Array)) {
      throw errcode(new Error('invalid key received'), 'ERR_INVALID_KEY')
    }

    const sh = await this._client.send({
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_CLOSEST_PEERS,
        key
      }
    })

    // stream begin message
    let message = await sh.read()
    let response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      await sh.close()
      throw errcode(new Error(response.error.msg), 'ERR_DHT_FIND_PROVIDERS_FAILED')
    }

    while (true) {
      message = await sh.read()
      response = DHTResponse.decode(message)

      // Stream end
      if (response.type === DHTResponse.Type.END) {
        await sh.close()
        return
      }

      // Stream values
      if (response.type === DHTResponse.Type.VALUE) {
        const peerId = PeerID.createFromBytes(response.value)

        yield { id: peerId }
      } else {
        // Unexpected message received
        await sh.close()
        throw errcode(new Error('unexpected message received'), 'ERR_UNEXPECTED_MESSAGE_RECEIVED')
      }
    }
  }

  /**
   * Query the DHT routing table for a given peer's public key.
   *
   * @param {PeerId} peerId
   * @returns {PublicKey}
   */
  async getPublicKey (peerId) {
    if (!PeerID.isPeerId(peerId)) {
      throw errcode(new Error('invalid peer id received'), 'ERR_INVALID_PEER_ID')
    }

    const sh = await this._client.send({
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_PUBLIC_KEY,
        peer: peerId.toBytes()
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    await sh.close()

    if (response.type !== Response.Type.OK) {
      throw errcode(new Error(response.error.msg), 'ERR_DHT_GET_PUBLIC_KEY_FAILED')
    }

    return response.dht.value
  }
}

module.exports = DHT
