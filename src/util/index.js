'use strict'

const { resolve } = require('path')

exports.passThroughUpgrader = {
  upgradeInbound: maConn => maConn,
  upgradeOutbound: maConn => maConn
}

/**
 * Converts the multiaddr to a nodejs NET compliant option
 * for .connect or .listen
 * @param {Multiaddr} addr
 * @returns {string|object} A nodejs NET compliant option
 */
function multiaddrToNetConfig (addr) {
  const listenPath = addr.getPath()
  // unix socket listening
  if (listenPath) {
    return resolve(listenPath)
  }
  // tcp listening
  return addr.nodeAddress()
}

module.exports.multiaddrToNetConfig = multiaddrToNetConfig
