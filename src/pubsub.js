'use strict'

const { CodeError } = require('@libp2p/interfaces/errors')

const {
  Request,
  Response,
  PSRequest,
  PSMessage
} = require('libp2p-daemon/src/protocol')

class Pubsub {
  /**
   * @class
   * @param {Client} client - libp2p daemon client instance
   */
  constructor (client) {
    this._client = client
  }

  /**
   * Get a list of topics the node is subscribed to.
   *
   * @returns {Array<string>} topics
   */
  async getTopics () {
    const sh = await this._client.send({
      type: Request.Type.PUBSUB,
      pubsub: {
        type: PSRequest.Type.GET_TOPICS
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    await sh.close()

    if (response.type !== Response.Type.OK) {
      throw new CodeError(response.error.msg, 'ERR_PUBSUB_GET_TOPICS_FAILED')
    }

    return response.pubsub.topics
  }

  /**
   * Publish data under a topic.
   *
   * @param {string} topic
   * @param {Buffer} data
   */
  async publish (topic, data) {
    if (typeof topic !== 'string') {
      throw new CodeError('invalid topic received', 'ERR_INVALID_TOPIC')
    }

    if (!(data instanceof Uint8Array)) {
      throw new CodeError('data received is not a Uint8Array', 'ERR_INVALID_DATA')
    }

    const sh = await this._client.send({
      type: Request.Type.PUBSUB,
      pubsub: {
        type: PSRequest.Type.PUBLISH,
        topic,
        data
      }
    })

    const message = await sh.read()
    const response = Response.decode(message)

    await sh.close()

    if (response.type !== Response.Type.OK) {
      throw new CodeError(response.error.msg, 'ERR_PUBSUB_PUBLISH_FAILED')
    }
  }

  /**
   * Request to subscribe a certain topic.
   *
   * @param {string} topic
   * @returns {Iterator<PSMessage>}
   */
  async subscribe (topic) {
    if (typeof topic !== 'string') {
      throw new CodeError('invalid topic received', 'ERR_INVALID_TOPIC')
    }

    const sh = await this._client.send({
      type: Request.Type.PUBSUB,
      pubsub: {
        type: PSRequest.Type.SUBSCRIBE,
        topic
      }
    })

    let message = await sh.read()
    let response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw new CodeError(response.error.msg, 'ERR_PUBSUB_PUBLISH_FAILED')
    }

    // stream messages
    return (async function * () {
      while (true) {
        message = await sh.read()
        response = PSMessage.decode(message)
        yield response
      }
    })()
  }
}

module.exports = Pubsub
