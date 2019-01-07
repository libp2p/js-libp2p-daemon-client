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
      throw errcode('invalid key received', 'ERR_INVALID_KEY')
    }

    if (!Buffer.isBuffer(value)) {
      throw errcode('value received is not a buffer', 'ERR_INVALID_VALUE')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.PUT_VALUE,
        key,
        value
      }
    }

    try {
      const message = await this._client.send(request).first()
      const response = Response.decode(message)

      if (response.type !== Response.Type.OK) {
        throw errcode(response.error.msg, 'ERR_DHT_PUT_FAILED')
      }

      return
    } catch (err) {
      throw err
    }
  }

  /**
   * Query the DHT for a value stored at a key in the DHT.
   * @param {String} key
   * @returns {Buffer}
   */
  async get (key) {
    if (typeof key !== 'string') {
      throw errcode('invalid key received', 'ERR_INVALID_KEY')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_VALUE,
        key
      }
    }

    try {
      const message = await this._client.send(request).first()
      const response = Response.decode(message)

      if (response.type !== Response.Type.OK) {
        throw errcode(response.error.msg, 'ERR_DHT_GET_FAILED')
      }

      return response.dht.value
    } catch (err) {
      throw err
    }
  }

  /**
   * Query the DHT for a given peer's known addresses.
   * @param {PeerId} peerId
   * @returns {PeerInfo}
   */
  async findPeer (peerId) {
    if (!PeerID.isPeerId(peerId)) {
      throw errcode('invalid peer id received', 'ERR_INVALID_PEER_ID')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.FIND_PEER,
        peer: peerId.toBytes()
      }
    }

    try {
      const message = await this._client.send(request).first()
      const response = Response.decode(message)

      if (response.type !== Response.Type.OK) {
        throw errcode(response.error.msg, 'ERR_DHT_FIND_PEER_FAILED')
      }

      const peerId = PeerID.createFromBytes(response.dht.peer.id)
      const peerInfo = new PeerInfo(peerId)

      response.dht.peer.addrs.forEach((addr) => {
        const ma = multiaddr(addr)

        peerInfo.multiaddrs.add(ma)
      })

      return peerInfo
    } catch (err) {
      throw err
    }
  }

  /**
   * Announce that have data addressed by a given CID
   * @param {CID} cid
   */
  async provide (cid) {
    if (!CID.isCID(cid)) {
      throw errcode('invalid cid received', 'ERR_INVALID_CID')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.PROVIDE,
        cid: cid.buffer
      }
    }

    try {
      const message = await this._client.send(request).first()
      const response = Response.decode(message)

      if (response.type !== Response.Type.OK) {
        throw errcode(response.error.msg, 'ERR_DHT_PROVIDE_FAILED')
      }

      return
    } catch (err) {
      throw err
    }
  }

  /**
   * Query the DHT for peers that have a piece of content, identified by a CID.
   * @param {CID} cid
   * @param {number} count number or results to include
   * @returns {Array<PeerInfo>}
   */
  async findProviders (cid, count = 1) {
    if (!CID.isCID(cid)) {
      throw errcode('invalid cid received', 'ERR_INVALID_CID')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.FIND_PROVIDERS,
        cid: cid.buffer,
        count
      }
    }

    let peerInfos = []
    let begin = false
    const stream = this._client.send(request)

    for await (const message of stream) {
      let response

      // message stream begin message
      if (!begin) {
        try {
          response = Response.decode(message)
        } catch (err) {
          throw err
        }

        if (response.type !== Response.Type.OK) {
          stream.end()
          throw errcode(response.error.msg, 'ERR_DHT_FIND_PROVIDERS_FAILED')
        }

        begin = true

        // message stream
      } else {
        try {
          response = DHTResponse.decode(message)
        } catch (err) {
          throw err
        }

        // Stream end
        if (response.type === DHTResponse.Type.END) {
          stream.end()
          return peerInfos
        }

        // Stream values
        if (response.type === DHTResponse.Type.VALUE) {
          const peerId = PeerID.createFromBytes(response.peer.id)
          const peerInfo = new PeerInfo(peerId)

          response.peer.addrs.forEach((addr) => {
            const ma = multiaddr(addr)

            peerInfo.multiaddrs.add(ma)
          })

          peerInfos.push(peerInfo)
        } else {
          // Unexpected message received
          throw errcode('unexpected message received', 'ERR_UNEXPECTED_MESSAGE_RECEIVED')
        }
      }
    }
  }

  /**
   * Query the DHT routing table for peers that are closest to a provided key.
   * @param {string} key
   * @returns {Array<PeerInfo>}
   */
  async getClosestPeers (key) {
    if (typeof key !== 'string') {
      throw errcode('invalid key received', 'ERR_INVALID_KEY')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_CLOSEST_PEERS,
        key
      }
    }

    const stream = this._client.send(request)
    let peerInfos = []
    let begin = false

    for await (const message of stream) {
      let response

      // message stream begin message
      if (!begin) {
        try {
          response = Response.decode(message)
        } catch (err) {
          throw err
        }

        if (response.type !== Response.Type.OK) {
          stream.end()
          throw errcode(response.error.msg, 'ERR_DHT_GET_CLOSEST_PEERS_FAILED')
        }

        begin = true

        // message stream
      } else {
        try {
          response = DHTResponse.decode(message)
        } catch (err) {
          throw err
        }

        // Stream end
        if (response.type === DHTResponse.Type.END) {
          stream.end()
          return peerInfos
        }

        // Stream values
        if (response.type === DHTResponse.Type.VALUE) {
          const peerId = PeerID.createFromBytes(response.value)
          const peerInfo = new PeerInfo(peerId)

          peerInfos.push(peerInfo)
        } else {
          // Unexpected message received
          throw errcode('unexpected message received', 'ERR_UNEXPECTED_MESSAGE_RECEIVED')
        }
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
      throw errcode('invalid peer id received', 'ERR_INVALID_PEER_ID')
    }

    const request = {
      type: Request.Type.DHT,
      dht: {
        type: DHTRequest.Type.GET_PUBLIC_KEY,
        peer: peerId.toBytes()
      }
    }

    try {
      const message = await this._client.send(request).first()
      const response = Response.decode(message)

      if (response.type !== Response.Type.OK) {
        throw errcode(response.error.msg, 'ERR_DHT_GET_PUBLIC_KEY_FAILED')
      }

      return response.dht.value
    } catch (err) {
      throw err
    }
  }
}

module.exports = DHT
