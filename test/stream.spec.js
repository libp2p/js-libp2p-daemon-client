/* eslint-env mocha */
'use strict'

const { expect } = require('aegir/utils/chai')
const pipe = require('it-pipe')
const { collect, take } = require('streaming-iterables')
const { toBuffer } = require('it-buffer')
const { fromString: uint8ArrayFromString } = require('uint8arrays/from-string')

const Client = require('../src')
const { createDaemon } = require('libp2p-daemon/src/daemon')
const { StreamInfo } = require('libp2p-daemon/src/protocol')
const StreamHandler = require('libp2p-daemon/src/stream-handler')

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
    const data = uint8ArrayFromString('test-data')
    const protocol = '/protocol/1.0.0'
    const socketAddr = getMultiaddr('/tmp/p2p-protocol-handler.sock', 9091)

    clientA = new Client(defaultMultiaddr)
    clientB = new Client(addr2)

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

    clientB.start(socketAddr, async (connection) => {
      const streamHandler = new StreamHandler({ stream: connection })

      // Read the stream info from the daemon, then pipe to echo
      const message = await streamHandler.read()
      const response = StreamInfo.decode(message)

      expect(response.peer).to.eql(identifyA.peerId.toBytes())
      expect(response.proto).to.eql(protocol)

      const stream = streamHandler.rest()

      // echo messages
      pipe(stream, stream)
    })

    // register an handler for inboud stream
    await clientB.registerStreamHandler(socketAddr, protocol)

    // open an outbound stream in client A and write to it
    const stream = await clientA.openStream(identifyB.peerId, protocol)

    const source = require('it-pushable')()
    source.push(data)

    const output = await pipe(
      source,
      stream,
      take(1),
      toBuffer,
      collect
    )

    source.end()
    expect(output).to.eql([data])
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
