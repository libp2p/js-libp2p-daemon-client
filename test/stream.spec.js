/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)

const { decode } = require('length-prefixed-stream')
const { createDaemon } = require('libp2p-daemon/src/daemon')
const Client = require('../src')
const { StreamInfo } = require('libp2p-daemon/src/protocol')

const { ends } = require('../src/util/iterator')
const { getMultiaddr } = require('./utils')
const defaultMultiaddr = getMultiaddr('/tmp/p2pd.sock')

describe('daemon stream client', function () {
  this.timeout(50e3)

  const addr2 = getMultiaddr('/tmp/p2pd-2.sock', 9090)
  let daemonA
  let daemonB
  let clientA
  let clientB

  const daemonOpts = (addr) => ({
    quiet: false,
    q: false,
    bootstrap: false,
    hostAddrs: '/ip4/0.0.0.0/tcp/0,/ip4/0.0.0.0/tcp/0/ws',
    b: false,
    dht: false,
    dhtClient: false,
    connMgr: false,
    listen: addr || defaultMultiaddr.toString(),
    id: '',
    bootstrapPeers: ''
  })

  before(async () => {
    [daemonA, daemonB] = await Promise.all([
      createDaemon(daemonOpts()),
      createDaemon(daemonOpts(addr2))
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
    await clientA && clientA.close()
    await clientB && clientB.close()
    await new Promise(resolve => setTimeout(resolve, 1000))
  })

  it('should be able to open a stream, write to it and a stream handler, should handle the message', async () => {
    const data = Buffer.from('test-data')
    const protocol = '/protocol/1.0.0'
    const socketAddr = getMultiaddr('/tmp/p2p-protocol-handler.sock', 9091)

    clientA = new Client(defaultMultiaddr)
    clientB = new Client(addr2)

    await Promise.all([
      clientA.attach(),
      clientB.attach()
    ])

    let identifyA
    try {
      identifyA = await clientA.identify()
    } catch (err) {
      expect(err).to.not.exist()
    }

    let identifyB
    try {
      identifyB = await clientB.identify()
    } catch (err) {
      expect(err).to.not.exist()
    }

    try {
      await clientA.connect(identifyB.peerId, identifyB.addrs)
    } catch (err) {
      expect(err).to.not.exist()
    }

    await new Promise(async (resolve) => {
      await clientB.startServer(socketAddr, async (conn) => {
        // Decode the stream
        const dec = decode()
        conn.pipe(dec)

        // Read the stream info from the daemon, then pipe to echo
        const message = await ends(dec).first()
        let response = StreamInfo.decode(message)

        expect(response.peer).to.eql(identifyA.peerId.toBytes())
        expect(response.proto).to.eql(protocol)

        conn.unpipe(dec)
        conn.end(() => {
          conn.destroy() // Windows CI was not having the stream properly closed
          resolve()
        })
      })

      // register an handler for inboud stream
      await clientB.registerStreamHandler(socketAddr, protocol)

      // open an outbound stream in client A and write to it
      const connA = await clientA.openStream(identifyB.peerId, protocol)

      connA.write(data)
      connA.end()
    })
  })

  it('should error if openStream receives an invalid peerId', async () => {
    let socket

    try {
      socket = await clientA.openStream('peerId', 'protocol')
    } catch (err) {
      expect(err).to.exist()
      expect(err.code).to.equal('ERR_INVALID_PEER_ID')
    }

    expect(socket).to.not.exist()
  })

  it('should error if openStream receives an invalid protocol', async () => {
    clientA = new Client(defaultMultiaddr)
    clientB = new Client(addr2)

    await Promise.all([
      clientA.attach(),
      clientB.attach()
    ])

    let identifyA
    try {
      identifyA = await clientA.identify()
    } catch (err) {
      expect(err).to.not.exist()
    }

    let socket

    try {
      socket = await clientA.openStream(identifyA.peerId, null)
    } catch (err) {
      expect(err).to.exist()
      expect(err.code).to.equal('ERR_INVALID_PROTOCOL')
    }

    expect(socket).to.not.exist()
  })

  it('should error if registerStreamHandler receives an invalid path', async () => {
    try {
      await clientA.registerStreamHandler(null, 'protocol')
    } catch (err) {
      expect(err).to.exist()
      expect(err.code).to.equal('ERR_INVALID_MULTIADDR')
    }
  })

  it('should error if registerStreamHandler receives an invalid protocol', async () => {
    const socketAddr = getMultiaddr('/tmp/p2p-protocol-handler.sock', 9091)

    try {
      await clientA.registerStreamHandler(socketAddr, null)
    } catch (err) {
      expect(err).to.exist()
      expect(err.code).to.equal('ERR_INVALID_PROTOCOL')
    }
  })
})
