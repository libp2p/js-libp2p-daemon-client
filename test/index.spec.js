/* eslint-env mocha */
'use strict'

const { expect } = require('aegir/utils/chai')
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

  it('should be able to start a server', async () => {
    const client1 = new Client(getMultiaddr('/tmp/p2pd.sock'))
    const client2 = new Client(getMultiaddr('/tmp/p2pd2.sock'))

    await client1.start(getMultiaddr('/tmp/p2pd2.sock'), () => {})

    await client2.connectDaemon(getMultiaddr('/tmp/p2pd2.sock'))
    await client2.close()
    await client1.close()
  })

  describe('identify', () => {
    let daemon
    let client

    before(async function () {
      const opts = daemonOpts()
      daemon = await createDaemon(opts)
      await daemon.start()
    })

    after(async () => {
      await daemon.stop()
    })

    afterEach(async () => {
      await client && client.close()
    })

    it('should be able to identify', async () => {
      client = new Client(defaultMultiaddr)

      const identify = await client.identify()

      expect(identify).to.exist()
      expect(identify.peerId).to.exist()
      expect(identify.addrs).to.exist()
      expect(PeerId.isPeerId(identify.peerId))
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
        await client.identify()
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.toString()).to.equal('Error: mock error')
      } finally {
        stub.restore()
      }
    })
  })

  describe('listPeers', () => {
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

    it('should be able to listPeers', async () => {
      client = new Client(defaultMultiaddr)

      const identify = await client.identify()

      // close first client
      await client.close()

      client = new Client(addr2)

      // list peers before connecting to a peer
      let peers = await client.listPeers()

      expect(peers).to.exist()
      expect(peers).to.have.length(0)

      await client.connect(identify.peerId, identify.addrs)

      // list peers after connecting to a peer
      peers = await client.listPeers()

      expect(peers).to.exist()
      expect(peers).to.have.length(1)
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
        await client.listPeers()
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_LIST_PEERS_FAILED')
      } finally {
        stub.restore()
      }
    })
  })

  describe('connect', () => {
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

    it('should be able to connect', async () => {
      client = new Client(defaultMultiaddr)
      const identify = await client.identify()

      // close first client
      await client.close()

      client = new Client(addr2)
      await client.connect(identify.peerId, identify.addrs)
    })

    describe('failure', () => {
      let stub

      afterEach(() => {
        if (stub != null) {
          stub.restore()
        }
        stub = null
      })

      it('should error if it receives an error with error property', async () => {
        client = new Client(defaultMultiaddr)
        const identify = await client.identify()
        client.close()

        client = new Client(addr2)

        stub = sinon.stub(Response, 'decode').returns({
          type: 'ERROR',
          error: {
            msg: 'mock error'
          }
        })
        await expect(client.connect(identify.peerId, identify.addrs)).to.be.rejectedWith(
          'mock error')
      })

      it('should error if it receives an error without message', async () => {
        client = new Client(defaultMultiaddr)
        const identify = await client.identify()
        client.close()

        client = new Client(addr2)

        stub = sinon.stub(Response, 'decode').returns({
          type: 'ERROR',
          error: {}
        })
        await expect(client.connect(identify.peerId, identify.addrs)).to.be.rejectedWith(
          'unspecified')
      })

      it('should error if it receives an error without details', async () => {
        client = new Client(defaultMultiaddr)
        const identify = await client.identify()
        client.close()

        client = new Client(addr2)

        stub = sinon.stub(Response, 'decode').returns({
          type: 'ERROR'
        })
        await expect(client.connect(identify.peerId, identify.addrs)).to.be.rejectedWith(
          'unspecified')
      })

      it('should error if it receives an undefined response', async () => {
        client = new Client(defaultMultiaddr)
        const identify = await client.identify()
        client.close()

        client = new Client(addr2)

        stub = sinon.stub(client, 'send').returns({
          read: () => { return undefined }
        })
        await expect(client.connect(identify.peerId, identify.addrs)).to.be.rejectedWith(
          'unspecified')
      })

      it('should error if it receives an empty response', async () => {
        client = new Client(defaultMultiaddr)
        const identify = await client.identify()
        client.close()

        client = new Client(addr2)

        stub = sinon.stub(client, 'send').returns({
          read: () => { return '' }
        })
        await expect(client.connect(identify.peerId, identify.addrs)).to.be.rejectedWith(
          'unspecified')
      })
    })

    it('should error if receive an invalid peerid', async () => {
      client = new Client(defaultMultiaddr)

      try {
        await client.connect('peerId')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_PEER_ID')
      }
    })

    it('should error if addrs received are not in an array', async () => {
      client = new Client(defaultMultiaddr)

      let identify
      try {
        identify = await client.identify()
      } catch (err) {
        expect(err).to.not.exist()
      }

      // close first client
      client.close()

      client = new Client(addr2)

      try {
        await client.connect(identify.peerId, 'addrs')
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_INVALID_ADDRS_TYPE')
      }
    })

    it('should error if any addrs received is not a multiaddr', async () => {
      client = new Client(defaultMultiaddr)

      const identify = await client.identify()

      // close first client
      client.close()

      client = new Client(addr2)

      try {
        await client.connect(identify.peerId, ['addrs'])
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).to.exist()
        expect(err.code).to.equal('ERR_NO_MULTIADDR_RECEIVED')
      }
    })
  })
})
