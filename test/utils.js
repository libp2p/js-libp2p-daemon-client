'use strict'

const os = require('os')
const path = require('path')
const ma = require('multiaddr')
const PeerID = require('peer-id')
const isWindows = Boolean(os.type().match(/windows/gi))

exports.getSockPath = (sockPath) => isWindows
  ? path.join('\\\\?\\pipe', sockPath)
  : path.resolve(os.tmpdir(), sockPath)

exports.isWindows = isWindows

exports.getMultiaddr = (sockPath, port) => isWindows
  ? ma(`/ip4/0.0.0.0/tcp/${port || 8080}`)
  : ma(`/unix${path.resolve(os.tmpdir(), sockPath)}`)

/**
 * @returns {Promise<PeerId>} Returns the generated `PeerId`
 */
exports.createPeerId = () => {
  return PeerID.create({ bits: 512 })
}
