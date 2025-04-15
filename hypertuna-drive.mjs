// hyperdrive-script.js
import Hyperswarm from 'hyperswarm'
import Hyperdrive from 'hyperdrive'
import Localdrive from 'localdrive'
import Corestore from 'corestore'
import debounce from 'debounceify'
import b4a from 'b4a'

const key = process.argv[2]
if (!key) throw new Error('provide a key')

// create a Corestore instance
const store = new Corestore('./storage-hypertuna-drive')
const swarm = new Hyperswarm()

// replication of store on connection with other peers
swarm.on('connection', conn => store.replicate(conn))

// create a local copy of the remote drive
const local = new Localdrive('./reader-dir')

// create a hyperdrive using the public key passed as a command-line argument
const drive = new Hyperdrive(store, b4a.from(key, 'hex'))

// wait till all the properties of the drive are initialized
await drive.ready()

const mirror = debounce(mirrorDrive)

// call the mirror function whenever content gets appended 
// to the Hypercore instance of the hyperdrive
drive.core.on('append', mirror)

const foundPeers = store.findingPeers()

// join a topic
swarm.join(drive.discoveryKey, { client: true, server: false })
swarm.flush().then(() => foundPeers())

// start the mirroring process (i.e copying the contents from remote drive to local dir)
mirror()

async function mirrorDrive () {
  const mirror = drive.mirror(local)
  await mirror.done()
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Gracefully shutting down Hyperdrive...')
  await swarm.destroy()
  process.exit(0)
})
