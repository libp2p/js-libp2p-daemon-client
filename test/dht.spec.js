/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const chaiBytes = require('chai-bytes')
const expect = chai.expect
chai.use(dirtyChai)
chai.use(chaiBytes)

const sinon = require('sinon')

const { createDaemon } = require('libp2p-daemon/src/daemon')
const Client = require('../src')
const { ends } = require('../src/util/iterator')
const { Response } = require('libp2p-daemon/src/protocol')

const CID = require('cids')

const { getMultiaddr, createPeerId } = require('./utils')
const defaultMultiaddr = getMultiaddr('/tmp/p2pd.sock')

describe('daemon dht client', function () {
  this.timeout(30e3)

  const daemonOpts = (addr) => ({
    quiet: false,
    q: false,
    bootstrap: false,
    b: false,
    dht: true,
    dhtClient: true,
    connMgr: false,
    listen: addr || defaultMultiaddr.toString(),
    id: '',
    bootstrapPeers: ''
  })

  describe('put', () => {
    let daemon
    let client

    const key = '/key'
    const value = Buffer.from('oh hello there')

    before(async function () {
      daemon = await createDaemon(daemonOpts())
      await daemon.start()
    })

    after(() => {
      return daemon.stop()
    })

    it('should be able to put a value to the dth', async function () {
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.put(key, value)
      } catch (err) {
        expect(err).to.not.exist()
      }

      await client.close()
    })

    it('should error if receive an error message', async () => {
      client = new Client(defaultMultiaddr)

      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        error: {
          msg: 'mock error'
        }
      })

      try {
        await client.dht.put(key, value)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_DHT_PUT_FAILED')
      } finally {
        stub.restore()
      }

      await client.close()
    })

    it('should error if receive an invalid key', async function () {
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.put(value, value)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_KEY')
      }

      await client.close()
    })

    it('should error if receive an invalid value', async function () {
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.put(key, key)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_VALUE')
      }

      await client.close()
    })
  })

  describe('get', () => {
    let daemon
    let client

    before(async function () {
      daemon = await createDaemon(daemonOpts())
      await daemon.start()
    })

    after(async () => {
      await daemon.stop()
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to get a value from the dth', async function () {
      const key = '/key'
      const value = Buffer.from('oh hello there')

      client = new Client(defaultMultiaddr)

      try {
        await client.dht.put(key, value)
      } catch (err) {
        expect(err).to.not.exist()
      }

      let data
      try {
        data = await client.dht.get(key)
      } catch (err) {
        expect(err).to.not.exist()
      }

      expect(data).to.exist()
      expect(data).to.equalBytes(value)
    })

    it('should error if receive an invalid key', async function () {
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.get(Buffer.from('/key'))
        expect('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_KEY')
      }
    })

    it('should error if it cannot get a value', async function () {
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.get('/unavailable-key')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
      }
    })
  })

  describe('findPeer', () => {
    const addr2 = getMultiaddr('/tmp/p2pd-2.sock', 9090)
    let daemonA
    let daemonB
    let client

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

    after(async function () {
      await Promise.all([
        daemonA.stop(),
        daemonB.stop()
      ])
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to find a peer', async () => {
      client = new Client(defaultMultiaddr)

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      await client.close()

      client = new Client(addr2)

      try {
        await client.connect(identify.peerId, identify.addrs)
      } catch (err) {
        expect(err).to.not.exist()
      }

      let result
      // Retry until we hit the test timeout since dht propagation isn't instant
      while (true) {
        try {
          result = await client.dht.findPeer(identify.peerId)
          break // we've got a result, exit the loop
        } catch (err) { /* ignore errors, we only care about the test timing out */ }
      }
      expect(result).to.exist()
      expect(result.id.toB58String()).to.equal(identify.peerId.toB58String())
    })

    it('should error if it gets an invalid peerId', async () => {
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.findPeer('fake-peerId')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_PEER_ID')
      }
    })

    it('should error if it cannot find the peer', async () => {
      const peerId = await createPeerId()
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.findPeer(peerId)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_DHT_FIND_PEER_FAILED')
      }
    })
  })

  describe('provide', () => {
    let daemon
    let client

    before(async function () {
      daemon = await createDaemon(daemonOpts())
      await daemon.start()
    })

    after(async () => {
      await daemon.stop()
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to provide', async () => {
      const cid = new CID('QmVzw6MPsF96TyXBSRs1ptLoVMWRv5FCYJZZGJSVB2Hp38')

      client = new Client(defaultMultiaddr)

      try {
        await client.dht.provide(cid)
      } catch (err) {
        expect(err).to.not.exist()
      }
    })

    it('should error if receive an error message', async () => {
      const cid = new CID('QmVzw6MPsF96TyXBSRs1ptLoVMWRv5FCYJZZGJSVB2Hp38')

      client = new Client(defaultMultiaddr)

      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        error: {
          msg: 'mock error'
        }
      })

      try {
        await client.dht.provide(cid)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_DHT_PROVIDE_FAILED')
      } finally {
        stub.restore()
      }
    })

    it('should error if it gets an invalid cid', async () => {
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.provide('cid')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_CID')
      }
    })
  })

  describe('findProviders', () => {
    let daemon
    let client

    before(async function () {
      daemon = await createDaemon(daemonOpts())
      await daemon.start()
    })

    after(async () => {
      await daemon.stop()
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should error if no provider for the cid exists', async () => {
      const cid = new CID('QmVzw6MPsF96TyXBSRs1ptLoVMWRv5FCYJZZGJSVB2Hp39')
      client = new Client(defaultMultiaddr)

      const findProviders = client.dht.findProviders(cid)
      const providers = []

      try {
        for await (const provider of findProviders) {
          providers.push(provider)
        }
      } catch (err) {
        expect(err).to.exist()
      }

      expect(providers).to.exist()
      expect(providers.length).to.equal(0)
    })

    it('should be able to find providers', async () => {
      const cid = new CID('QmVzw6MPsF96TyXBSRs1ptLoVMWRv5FCYJZZGJSVB2Hp38')

      client = new Client(defaultMultiaddr)

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      try {
        await client.dht.provide(cid)
      } catch (err) {
        expect(err).to.not.exist()
      }

      const findProviders = client.dht.findProviders(cid)
      const providers = []

      for await (const provider of findProviders) {
        providers.push(provider)
      }

      expect(providers).to.exist()
      expect(providers[0]).to.exist()
      expect(providers[0].id.toB58String()).to.equal(identify.peerId.toB58String())
    })

    it('should error if it gets an invalid cid', async () => {
      client = new Client(defaultMultiaddr)

      try {
        await ends(client.dht.findProviders('cid')).first()
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_CID')
      }
    })
  })

  describe('getClosestPeers', () => {
    const addr2 = getMultiaddr('/tmp/p2pd-2.sock', 9090)
    let daemonA
    let daemonB
    let client

    const key = 'foobar'

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

    after(async function () {
      await Promise.all([
        daemonA.stop(),
        daemonB.stop()
      ])
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should get an empty array if it does not know any peer', async () => {
      client = new Client(defaultMultiaddr)

      const getClosestPeers = client.dht.getClosestPeers(key)
      const closestPeers = []

      for await (const peer of getClosestPeers) {
        closestPeers.push(peer)
      }

      expect(closestPeers).to.exist()
      expect(closestPeers.length).to.equal(0)
    })

    it('should be able to get the closest peers', async () => {
      client = new Client(defaultMultiaddr)

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      await client.close()

      client = new Client(addr2)

      try {
        await client.connect(identify.peerId, identify.addrs)
      } catch (err) {
        expect(err).to.not.exist()
      }

      let closestPeers = []

      // Retry until we hit the test timeout since dht propagation isn't instant
      while (true) {
        try {
          const getClosestPeers = client.dht.getClosestPeers(key)

          closestPeers = []
          for await (const peer of getClosestPeers) {
            closestPeers.push(peer)
          }

          if (closestPeers && closestPeers.length) {
            break // we've got a result, exit the loop
          }
        } catch (err) { /* ignore errors, we only care about the test timing out */ }
      }
      expect(closestPeers).to.exist()
      expect(closestPeers[0]).to.exist()
    })

    it('should error if it gets an invalid key', async () => {
      client = new Client(defaultMultiaddr)

      try {
        await ends(client.dht.getClosestPeers(1)).first()
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_KEY')
      }
    })
  })

  describe('getPublicKey', () => {
    const addr2 = getMultiaddr('/tmp/p2pd-2.sock', 9090)
    let daemonA
    let daemonB
    let client

    before(async () => {
      [daemonA, daemonB] = await Promise.all([
        createDaemon(daemonOpts()),
        createDaemon(daemonOpts(addr2.toString()))
      ])

      await Promise.all([
        daemonA.start(),
        daemonB.start()
      ])
    })

    after(async () => {
      await Promise.all([
        daemonA.stop(),
        daemonB.stop()
      ])
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to get the public key', async () => {
      client = new Client(defaultMultiaddr)

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      await client.close()

      client = new Client(addr2)

      try {
        await client.connect(identify.peerId, identify.addrs)
      } catch (err) {
        expect(err).to.not.exist()
      }

      let result

      try {
        result = await client.dht.getPublicKey(identify.peerId)
      } catch (err) {
        expect(err).to.not.exist()
      }

      expect(result).to.exist()
    })

    it.skip('should error if it cannot find the peer', async () => {
      const peerId = await createPeerId()
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.getPublicKey(peerId)
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.eql('ERR_DHT_GET_PUBLIC_KEY_FAILED')
      }
    })

    it('should error if it receives an invalid peerId', async () => {
      client = new Client(defaultMultiaddr)

      try {
        await client.dht.getPublicKey('fake-peerId')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_PEER_ID')
      }
    })
  })
})
