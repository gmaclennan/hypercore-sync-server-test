const ram = require('random-access-memory')
const hypercore = require('hypercore')
const readBytes = require('read-bytes-stream')
const net = require('net')
const pump = require('pump')
const sodium = require('sodium-universal')

;(async () => {
  const clientFeeds = await Promise.all(
    Array(10)
      .fill(undefined)
      .map(createFeed)
  )
  const publicKeys = clientFeeds.map(f => f.key)
  await startServer(publicKeys)

  for (const feed of clientFeeds) {
    replicateClientWithServer(feed)
  }
})()

// publicKey === undefined -> create new feed as owner
// typeof publicKey === 'string' -> create read-only feed
async function createFeed (publicKey) {
  const feed = hypercore(ram, publicKey)
  return new Promise(resolve =>
    feed.on('ready', () => {
      if (!publicKey) feed.append('hello')
      resolve(feed)
    })
  )
}

async function startServer (feedKeys) {
  const server = net.createServer(conn => {
    const incoming = readBytes(32, async (pid, swap) => {
      if (pid.length < 32) return swap(new Error('Invalid request'))

      const feedKey = feedKeys.find(key => pid.equals(getProjectId(key)))
      if (!feedKey) return swap(new Error('No match: ' + stringifyKey(pid)))

      console.log('replicating feed ' + stringifyKey(feedKey))
      console.log(
        `${conn.localAddress}:${conn.localPort} <-> ${conn.remoteAddress}:${conn.remotePort}\n`
      )

      // Start up process and get a duplex sync stream somehow
      const syncStream = await getSyncStream(feedKey)
      swap(null, syncStream)
    })
    pump(conn, incoming, conn)
  })

  return new Promise(resolve => server.listen(8081, resolve))
}

function replicateClientWithServer (feed) {
  const client = net.createConnection({ port: 8081 }, () => {
    client.write(getProjectId(feed.key))
    pump(client, feed.replicate(true, { live: true }), client, console.log)
  })
}

async function getSyncStream (feedKey, cb) {
  const feed = await createFeed(feedKey)
  feed.on('download', (index, data) => {
    console.log(
      `feed ${stringifyKey(feed.key)} downloaded index ${index}: ${data}`
    )
  })
  return feed.replicate(false, { live: true })
}

function stringifyKey (keyBuf) {
  return keyBuf.toString('hex').slice(0, 7)
}

const MAPEOWEB = Buffer.from('mapeoweb')
function getProjectId (publicKey) {
  const digest = Buffer.allocUnsafe(32)
  sodium.crypto_generichash(digest, MAPEOWEB, publicKey)
  return digest
}
