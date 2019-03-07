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
const { getSockPath } = require('./utils')
const defaultSock = getSockPath('/tmp/p2pd.sock')

describe('daemon stream client', function () {
  this.timeout(50e3)

  const sock2 = getSockPath('/tmp/p2pd-2.sock')
  let daemonA
  let daemonB
  let clientA
  let clientB

  const daemonOpts = (sock) => ({
    quiet: false,
    q: false,
    bootstrap: false,
    hostAddrs: '/ip4/0.0.0.0/tcp/0,/ip4/0.0.0.0/tcp/0/ws',
    b: false,
    dht: false,
    dhtClient: false,
    connMgr: false,
    sock: sock || defaultSock,
    id: '',
    bootstrapPeers: ''
  })

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

  after(async function () {
    return Promise.all([
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
    const socketPath = getSockPath('/tmp/p2p-protocol-handler.sock')

    clientA = new Client(defaultSock)
    clientB = new Client(sock2)

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

    return new Promise(async (resolve) => {
      await clientB.startServer(socketPath, async (conn) => {
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
      await clientB.registerStreamHandler(socketPath, protocol)

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
    clientA = new Client(defaultSock)
    clientB = new Client(sock2)

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
      expect(err.code).to.equal('ERR_INVALID_PATH')
    }
  })

  it('should error if registerStreamHandler receives an invalid protocol', async () => {
    const socketPath = getSockPath('/tmp/p2p-protocol-handler.sock')

    try {
      await clientA.registerStreamHandler(socketPath, null)
    } catch (err) {
      expect(err).to.exist()
      expect(err.code).to.equal('ERR_INVALID_PROTOCOL')
    }
  })
})
