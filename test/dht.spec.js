/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const chaiBytes = require('chai-bytes')
const expect = chai.expect
chai.use(dirtyChai)
chai.use(chaiBytes)

const sinon = require('sinon')
const promiseRetry = require('promise-retry')

const { createDaemon } = require('libp2p-daemon/src/daemon')
const Client = require('../src')
const { Response } = require('libp2p-daemon/src/protocol')

const CID = require('cids')
const PeerID = require('peer-id')

const { getSockPath } = require('./utils')
const defaultSock = getSockPath('/tmp/p2pd.sock')

describe('daemon dht client', function () {
  this.timeout(30e3)

  const daemonOpts = (sock) => ({
    quiet: false,
    q: false,
    bootstrap: false,
    b: false,
    dht: true,
    dhtClient: true,
    connMgr: false,
    sock: sock || defaultSock,
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
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.put(key, value)
      } catch (err) {
        expect(err).to.not.exist()
      }

      await client.close()
    })

    it('should error if receive an error message', async () => {
      client = new Client(defaultSock)

      await client.attach()

      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        error: {
          msg: 'mock error'
        }
      })

      try {
        await client.dht.put(key, value)
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_DHT_PUT_FAILED')
      } finally {
        stub.restore()
      }

      await client.close()
    })

    it('should error if receive an invalid key', async function () {
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.put(value, value)
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_KEY')
      }

      await client.close()
    })

    it('should error if receive an invalid value', async function () {
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.put(key, key)
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

    after(() => {
      return daemon.stop()
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to get a value from the dth', async function () {
      const key = '/key'
      const value = Buffer.from('oh hello there')

      client = new Client(defaultSock)

      await client.attach()

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
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.get(Buffer.from('/key'))
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_KEY')
      }
    })

    it('should error if it cannot get a value', async function () {
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.get('/unavailable-key')
      } catch (err) {
        expect(err).to.exist()
      }
    })
  })

  describe('findPeer', () => {
    const sock2 = getSockPath('/tmp/p2pd-2.sock')
    let daemonA
    let daemonB
    let client

    before(function () {
      return Promise.all([
        createDaemon(daemonOpts()),
        createDaemon(daemonOpts(sock2))
      ]).then((res) => {
        daemonA = res[0]
        daemonB = res[1]

        return Promise.all([
          daemonA.start(),
          daemonB.start()
        ])
      })
    })

    after(function () {
      return Promise.all([
        daemonA.stop(),
        daemonB.stop()
      ])
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to find a peer', async () => {
      client = new Client(defaultSock)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      client.close()

      client = new Client(sock2)

      await client.attach()

      try {
        await client.connect(identify.peerId, identify.addrs)
      } catch (err) {
        expect(err).to.not.exist()
      }

      let result

      // try 5 times as the peer takes a while to get in the routing table
      return promiseRetry(async (retry, number) => {
        try {
          result = await client.dht.findPeer(identify.peerId)
        } catch (err) {
          return retry()
        }

        if (!result && number < 5) {
          return retry()
        }
        Promise.resolve()
      }).then(() => {
        expect(result).to.exist()
        expect(result.id.toB58String()).to.equal(identify.peerId.toB58String())
      }).catch((err) => {
        expect(err).to.not.exist()
      })
    })

    it('should error if it gets an invalid peerId', async () => {
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.findPeer('fake-peerId')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_PEER_ID')
      }
    })

    it('should error if it cannot find the peer', async () => {
      PeerID.create({ bits: 512 }, async (err, peerId) => {
        expect(err).to.not.exist()
        client = new Client(defaultSock)

        await client.attach()

        try {
          await client.dht.findPeer(peerId)
        } catch (err) {
          expect(err).to.exist()
          expect(err.code).to.equal('ERR_DHT_FIND_PEER_FAILED')
        }
      })
    })
  })

  describe('provide', () => {
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

    it('should be able to provide', async () => {
      const cid = new CID('QmVzw6MPsF96TyXBSRs1ptLoVMWRv5FCYJZZGJSVB2Hp38')

      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.provide(cid)
      } catch (err) {
        expect(err).to.not.exist()
      }
    })

    it('should error if receive an error message', async () => {
      const cid = new CID('QmVzw6MPsF96TyXBSRs1ptLoVMWRv5FCYJZZGJSVB2Hp38')

      client = new Client(defaultSock)

      await client.attach()

      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        error: {
          msg: 'mock error'
        }
      })

      try {
        await client.dht.provide(cid)
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_DHT_PROVIDE_FAILED')
      } finally {
        stub.restore()
      }

      await client.close()
    })

    it('should error if it gets an invalid cid', async () => {
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.provide('cid')
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

    after(() => {
      return daemon.stop()
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should receive empty providers if no provider for the cid exists', async () => {
      const cid = new CID('QmVzw6MPsF96TyXBSRs1ptLoVMWRv5FCYJZZGJSVB2Hp39')
      client = new Client(defaultSock)

      await client.attach()

      const findProviders = client.dht.findProviders(cid)
      let providers = []

      for await (const provider of findProviders) {
        providers.push(provider)
      }

      expect(providers).to.exist()
      expect(providers.length).to.equal(0)
    })

    it('should be able to find providers', async () => {
      const cid = new CID('QmVzw6MPsF96TyXBSRs1ptLoVMWRv5FCYJZZGJSVB2Hp38')

      client = new Client(defaultSock)

      await client.attach()

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
      let providers = []

      for await (const provider of findProviders) {
        providers.push(provider)
      }

      expect(providers).to.exist()
      expect(providers[0]).to.exist()
      expect(providers[0].id.toB58String()).to.equal(identify.peerId.toB58String())
    })

    it('should error if it gets an invalid cid', async () => {
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.findProviders('cid')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_CID')
      }
    })
  })

  describe('getClosestPeers', () => {
    const sock2 = getSockPath('/tmp/p2pd-2.sock')
    let daemonA
    let daemonB
    let client

    const key = 'foobar'

    before(function () {
      return Promise.all([
        createDaemon(daemonOpts()),
        createDaemon(daemonOpts(sock2))
      ]).then((res) => {
        daemonA = res[0]
        daemonB = res[1]

        return Promise.all([
          daemonA.start(),
          daemonB.start()
        ])
      })
    })

    after(function () {
      return Promise.all([
        daemonA.stop(),
        daemonB.stop()
      ])
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should get an empty array if it does not know any peer', async () => {
      client = new Client(defaultSock)

      await client.attach()

      const getClosestPeers = client.dht.getClosestPeers(key)
      let closestPeers = []

      for await (const peer of getClosestPeers) {
        closestPeers.push(peer)
      }

      expect(closestPeers).to.exist()
      expect(closestPeers.length).to.equal(0)
    })

    it('should be able to get the closest peers', async () => {
      client = new Client(defaultSock)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      client.close()

      client = new Client(sock2)
      await client.attach()

      try {
        await client.connect(identify.peerId, identify.addrs)
      } catch (err) {
        expect(err).to.not.exist()
      }

      let closestPeers = []

      // try 5 times as the peer takes a while to get in the routing table
      return promiseRetry(async (retry, number) => {
        const getClosestPeers = client.dht.getClosestPeers(key)

        closestPeers = []
        for await (const peer of getClosestPeers) {
          closestPeers.push(peer)
        }

        if ((!closestPeers || !closestPeers.length) && number < 5) {
          return retry()
        }
        Promise.resolve()
      }).then(() => {
        expect(closestPeers).to.exist()
        expect(closestPeers[0]).to.exist()
      }).catch((err) => {
        expect(err).to.not.exist()
      })
    })

    it('should error if it gets an invalid key', async () => {
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.getClosestPeers(1)
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_KEY')
      }
    })
  })

  describe('getPublicKey', () => {
    const sock2 = getSockPath('/tmp/p2pd-2.sock')
    let daemonA
    let daemonB
    let client

    before(function () {
      return Promise.all([
        createDaemon(daemonOpts()),
        createDaemon(daemonOpts(sock2))
      ]).then((res) => {
        daemonA = res[0]
        daemonB = res[1]

        return Promise.all([
          daemonA.start(),
          daemonB.start()
        ])
      })
    })

    after(function () {
      return Promise.all([
        daemonA.stop(),
        daemonB.stop()
      ])
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to get the public key', async () => {
      client = new Client(defaultSock)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      client.close()

      client = new Client(sock2)

      await client.attach()

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

    it('should error if it cannot find the peer', async () => {
      PeerID.create({ bits: 512 }, async (err, peerId) => {
        expect(err).to.not.exist()
        client = new Client(defaultSock)

        await client.attach()

        try {
          await client.dht.getPublicKey(peerId)
        } catch (err) {
          expect(err).to.exist()
        }
      })
    })

    it('should error if it receives an invalid peerId', async () => {
      client = new Client(defaultSock)

      await client.attach()

      try {
        await client.dht.getPublicKey('fake-peerId')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_PEER_ID')
      }
    })
  })
})
