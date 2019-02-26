/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const sinon = require('sinon')

const { createDaemon } = require('libp2p-daemon/src/daemon')
const Client = require('../src')
const { Response } = require('libp2p-daemon/src/protocol')

const PeerId = require('peer-id')

const { getMultiaddr } = require('./utils')
const defaultMultiaddr = getMultiaddr('/tmp/p2pd.sock')

describe('daemon client', function () {
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
    bootstrapPeers: ''
  })

  describe('identify', () => {
    let daemon
    let client

    before(function () {
      let opts = daemonOpts()
      createDaemon(opts).then((res) => {
        daemon = res

        return daemon.start()
      })
    })

    after(() => {
      return daemon.stop()
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to identify', async () => {
      client = new Client(defaultMultiaddr)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      expect(identify).to.exist()
      expect(identify.peerId).to.exist()
      expect(identify.addrs).to.exist()
      expect(PeerId.isPeerId(identify.peerId))
    })

    it('should error if receive an error message', async () => {
      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        ErrorResponse: {
          msg: 'mock error'
        }
      })

      client = new Client(defaultMultiaddr)

      await client.attach()

      try {
        await client.identify()
      } catch (err) {
        expect(err).to.exist()
        expect(err.toString()).to.equal('Error: mock error')
      } finally {
        stub.restore()
      }
    })
  })

  describe('listPeers', () => {
    const addr2 = getMultiaddr('/tmp/p2pd-2.sock')
    let daemonA
    let daemonB
    let client

    before(function () {
      return Promise.all([
        createDaemon(daemonOpts()),
        createDaemon(daemonOpts(addr2.toString()))
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

    it('should be able to listPeers', async () => {
      client = new Client(defaultMultiaddr)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      client.close()

      client = new Client(addr2)

      await client.attach()

      // list peers before connecting to a peer
      let peers
      try {
        peers = await client.listPeers()
      } catch (err) {
        expect(err).to.not.exist()
      }

      expect(peers).to.exist()
      expect(peers).to.have.length(0)

      try {
        await client.connect(identify.peerId, identify.addrs)
      } catch (err) {
        expect(err).to.not.exist()
      }

      // list peers after connecting to a peer
      try {
        peers = await client.listPeers()
      } catch (err) {
        expect(err).to.not.exist()
      }

      expect(peers).to.exist()
      expect(peers).to.have.length(1)
    })

    it('should error if receive an error message', async () => {
      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        ErrorResponse: {
          msg: 'mock error'
        }
      })

      client = new Client(defaultMultiaddr)

      await client.attach()

      try {
        await client.listPeers()
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_LIST_PEERS_FAILED')
      } finally {
        stub.restore()
      }
    })
  })

  describe('connect', () => {
    const addr2 = getMultiaddr('/tmp/p2pd-2.sock')
    let daemonA
    let daemonB
    let client

    before(function () {
      return Promise.all([
        createDaemon(daemonOpts()),
        createDaemon(daemonOpts(addr2.toString()))
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

    it('should be able to connect', async () => {
      client = new Client(defaultMultiaddr)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      client.close()

      client = new Client(addr2)

      await client.attach()

      try {
        await client.connect(identify.peerId, identify.addrs)
      } catch (err) {
        expect(err).to.not.exist()
      }
    })

    it('should error if receive an error message', async () => {
      client = new Client(defaultMultiaddr)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      const stub = sinon.stub(Response, 'decode').returns({
        type: 'ERROR',
        ErrorResponse: {
          msg: 'mock error'
        }
      })

      // close first client
      client.close()

      client = new Client(addr2)

      await client.attach()

      try {
        await client.connect(identify.peerId, identify.addrs)
      } catch (err) {
        expect(err).to.exist()
        expect(err.toString()).to.equal('Error: mock error')
      } finally {
        stub.restore()
      }
    })

    it('should error if receive an invalid peerid', async () => {
      client = new Client(defaultMultiaddr)

      await client.attach()

      try {
        await client.connect('peerId')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_PEER_ID')
      }
    })

    it('should error if addrs received are not in an array', async () => {
      client = new Client(defaultMultiaddr)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      client.close()

      client = new Client(addr2)

      await client.attach()

      try {
        await client.connect(identify.peerId, 'addrs')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_ADDRS_TYPE')
      }
    })

    it('should error if any addrs received is not a multiaddr', async () => {
      client = new Client(defaultMultiaddr)

      await client.attach()

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      client.close()

      client = new Client(addr2)

      await client.attach()

      try {
        await client.connect(identify.peerId, ['addrs'])
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_NO_MULTIADDR_RECEIVED')
      }
    })
  })
})
