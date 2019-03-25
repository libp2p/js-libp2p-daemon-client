'use strict'

const errcode = require('err-code')

const streamToIterator = require('stream-to-iterator')

const {
  Request,
  Response,
  PSRequest,
  PSMessage
} = require('libp2p-daemon/src/protocol')

class Pubsub {
  /**
   * @constructor
   * @param {Client} client libp2p daemon client instance
   */
  constructor (client) {
    this._client = client
  }

  /**
   * Get a list of topics the node is subscribed to.
   * @returns {Array<String>} topics
   */
  async getTopics () {
    const request = {
      type: Request.Type.PUBSUB,
      pubsub: {
        type: PSRequest.Type.GET_TOPICS
      }
    }

    const message = await this._client.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(response.error.msg, 'ERR_PUBSUB_GET_TOPICS_FAILED')
    }

    return response.pubsub.topics
  }

  /**
   * Publish data under a topic.
   * @param {String} topic
   * @param {Buffer} data
   */
  async publish (topic, data) {
    if (typeof topic !== 'string') {
      throw errcode('invalid topic received', 'ERR_INVALID_TOPIC')
    }

    if (!Buffer.isBuffer(data)) {
      throw errcode('data received is not a buffer', 'ERR_INVALID_DATA')
    }

    const request = {
      type: Request.Type.PUBSUB,
      pubsub: {
        type: PSRequest.Type.PUBLISH,
        topic,
        data
      }
    }

    const message = await this._client.send(request).first()
    const response = Response.decode(message)

    if (response.type !== Response.Type.OK) {
      throw errcode(response.error.msg, 'ERR_PUBSUB_PUBLISH_FAILED')
    }
  }

  /**
   * Request to subscribe a certain topic.
   * @param {String} topic
   * @returns {Iterator<PSMessage>}
   */
  async subscribe (topic) {
    if (typeof topic !== 'string') {
      throw errcode('invalid topic received', 'ERR_INVALID_TOPIC')
    }

    const request = {
      type: Request.Type.PUBSUB,
      pubsub: {
        type: PSRequest.Type.SUBSCRIBE,
        topic
      }
    }

    // stream initial message
    const stream = streamToIterator(this._client.send(request))
    let result = await stream.next()
    let response = Response.decode(result.value)

    if (response.type !== Response.Type.OK) {
      throw errcode(response.error.msg, 'ERR_PUBSUB_PUBLISH_FAILED')
    }

    // stream remaining messages
    return (async function * () {
      for await (const message of stream) {
        response = PSMessage.decode(message)

        yield response
      }
    })()
  }
}

module.exports = Pubsub
