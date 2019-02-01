libp2p-daemon client JavaScript implementation
======

> A Javascript client to interact with a standalone deployment of a libp2p host, running in its own OS process. Essentially, this client allows to communicate with other peers, interact with the DHT, participate in pubsub, etc. no matter the language they are implemented with.

## Lead Maintainer

[Vasco Santos](https://github.com/vasco-santos)

## Table of Contents

* [Specs](#specs)
* [Install](#install)
* [Usage](#usage)
* [API](#api)
* [Contribute](#contribute)
* [License](#license)

## Specs

The specs for the daemon are currently housed in the go implementation. You can read them at [libp2p/go-libp2p-daemon](https://github.com/libp2p/go-libp2p-daemon/blob/master/specs/README.md)

## Install

`npm install libp2p-daemon-client`

## Usage

### Run a daemon process

There are currently two implementations of the `libp2p-daemon`:

- [js-libp2p-daemon](https://github.com/libp2p/js-libp2p-daemon)
- [go-libp2p-daemon](https://github.com/libp2p/go-libp2p-daemon)

### Interact with the daemon process using the client

```js
const Client = require('libp2p-daemon-client')

const defaultSock = '/tmp/p2pd.sock'
const client = new Client(defaultSock)

// connect to a daemon
await client.attach()

// interact with the daemon
let identify
try {
  identify = await client.identify()
} catch (err) {
  // ...
}

// close the socket
await client.close()
```

## API

* [Getting started](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#getting-started)
* [`attach`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#attach)
* [`close`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#close)
* [`connect`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#connect)
* [`identify`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#identify)
* [`listPeers`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#listPeers)
* [`dht.put`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#dht.put)
* [`dht.get`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#dht.get)
* [`dht.findPeer`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#dht.findPeer)
* [`dht.provide`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#dht.provide)
* [`dht.findProviders`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#dht.findProviders)
* [`dht.getClosestPeers`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#dht.getClosestPeers)
* [`dht.getPublicKey`](https://github.com/libp2p/libp2p-daemon-client/blob/master/API.md#dht.getPublicKey)

## Contribute

This module is actively under development. Please check out the issues and submit PRs!

## License

MIT © Protocol Labs