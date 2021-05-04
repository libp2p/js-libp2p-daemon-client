/* eslint-env mocha */
'use strict'

const { expect } = require('aegir/utils/chai')
const sinon = require('sinon')

const uint8ArrayFromString = require('uint8arrays/from-string')
const { Response } = require('libp2p-daemon/src/protocol')
const { createDaemon } = require('libp2p-daemon/src/daemon')
const Client = require('../src')

const { getMultiaddr } = require('./utils')
const defaultMultiaddr = getMultiaddr('/tmp/p2pd.sock')

describe('daemon pubsub client', function () {
  this.timeout(30e3)

  const daemonOpts = (addr) => ({
    quiet: false,
    q: false,
    bootstrap: false,
    b: false,
    dht: false,
    dhtClient: false,
    connMgr: false,
    listen: addr || defaultMultiaddr.toString(),
    id: '',
    bootstrapPeers: '',
    pubsub: true
  })

  describe('getTopics', () => {
    let daemon
    let client

    before(async function () {
      daemon = await createDaemon(daemonOpts())
      await daemon.start()
    })

    after(() => {
      return daemon.stop()
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should get empty list of topics when no subscriptions exist', async () => {
      client = new Client(defaultMultiaddr)

      const topics = await client.pubsub.getTopics()

      expect(topics).to.have.lengthOf(0)
    })

    it('should get a list with a topic when subscribed', async () => {
      const topic = 'test-topic'
      client = new Client(defaultMultiaddr)

      await client.pubsub.subscribe(topic)

      const topics = await client.pubsub.getTopics()

      expect(topics).to.have.lengthOf(1)
      expect(topics[0]).to.eql(topic)
    })

    it('should error if receive an error message', async () => {
      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        error: {
          msg: 'mock error'
        }
      })

      client = new Client(defaultMultiaddr)

      try {
        await client.pubsub.getTopics()
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.toString()).to.equal('Error: mock error')
      } finally {
        stub.restore()
      }
    })
  })

  describe('subscribe and publish', () => {
    const addr2 = getMultiaddr('/tmp/p2pd-2.sock', 9090)
    let daemonA
    let daemonB
    let client1
    let client2

    before(async function () {
      [daemonA, daemonB] = await Promise.all([
        createDaemon(daemonOpts()),
        createDaemon(daemonOpts(addr2.toString()))
      ])

      await Promise.all([
        daemonA.start(),
        daemonB.start()
      ])
    })

    afterEach(async () => {
      await Promise.all([
        client1.close(),
        client2.close()
      ])
    })

    after(async function () {
      await Promise.all([
        daemonA.stop(),
        daemonB.stop()
      ])
    })

    it('should subscribe to messages and receive them when published', async () => {
      const topic = 'test-topic'
      const data = uint8ArrayFromString('test-data')

      client1 = new Client(defaultMultiaddr)
      client2 = new Client(addr2)

      // identify
      const identify2 = await client2.identify()

      // connect
      await client1.connect(identify2.peerId, identify2.addrs)

      const subscribeIterator = await client1.pubsub.subscribe(topic)

      const subscriber = async () => {
        const { value: message } = await subscribeIterator.next()
        expect(message).to.exist()
        expect(message.data).to.exist()
        expect(message.data).to.equalBytes(data)
      }

      const publisher = async () => {
        // wait for subscribption stream
        await new Promise(resolve => setTimeout(resolve, 200))
        return client2.pubsub.publish(topic, data)
      }

      return Promise.all([
        subscriber(),
        publisher()
      ])
    })

    it('should error if publish receives an invalid topic', async () => {
      const topic = uint8ArrayFromString('test-topic')
      const data = uint8ArrayFromString('test-data')

      client1 = new Client(defaultMultiaddr)

      try {
        await client1.pubsub.publish(topic, data)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_TOPIC')
      }
    })

    it('should error if publish receives an invalid data', async () => {
      const topic = 'test-topic'
      const data = 'test-data'

      client1 = new Client(defaultMultiaddr)

      try {
        await client1.pubsub.publish(topic, data)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_DATA')
      }
    })

    it('should error if publish receives an error message', async () => {
      const topic = 'test-topic'
      const data = uint8ArrayFromString('test-data')

      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        error: {
          msg: 'mock error'
        }
      })

      client1 = new Client(defaultMultiaddr)

      try {
        await client1.pubsub.publish(topic, data)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.toString()).to.equal('Error: mock error')
      } finally {
        stub.restore()
      }
    })

    it('should error if subscribe receives an invalid topic', async () => {
      const topic = uint8ArrayFromString('test-topic')

      client1 = new Client(defaultMultiaddr)

      try {
        await client1.pubsub.subscribe(topic)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_TOPIC')
      }
    })
  })
})
