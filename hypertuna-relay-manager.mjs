// tunafish-relay-x2.mjs
import Corestore from 'corestore';
import Hyperswarm from 'hyperswarm';
import NostrRelay from './hypertuna-relay-event-processor.mjs';
import b4a from 'b4a';
import c from 'compact-encoding';
import Protomux from 'protomux';
import { secp256k1 } from '@noble/curves/secp256k1';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';

function verifyEventSignature(event) {
  try {
      console.log('=== Verifying Event Signature ===');
      const serialized = serializeEvent(event);
      console.log('Serialized Event:', serialized);
      
      const hash = sha256(new TextEncoder().encode(serialized));
      console.log('Event Hash:', bytesToHex(hash));
      
      const pubkey = hexToBytes(event.pubkey);
      const signature = hexToBytes(event.sig);
      
      console.log('Verification Details:');
      console.log('Public Key:', event.pubkey);
      console.log('Signature:', event.sig);
      
      const isValid = schnorr.verify(signature, hash, pubkey);
      console.log('Verification Result:', isValid);
      return isValid;
  } catch (err) {
      console.error('Error verifying event signature:', err);
      return false;
  }
}

  function serializeEvent(event) {
    return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  }

function getEventHash(event) {
    const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
    return bytesToHex(sha256(new TextEncoder().encode(serialized)));
  }

function validateEvent(event) {
  if (typeof event.kind !== 'number') return false;
  if (typeof event.content !== 'string') return false;
  if (typeof event.created_at !== 'number') return false;
  if (typeof event.pubkey !== 'string') return false;
  if (!event.pubkey.match(/^[a-f0-9]{64}$/)) return false;

  if (!Array.isArray(event.tags)) return false;
  for (let tag of event.tags) {
    if (!Array.isArray(tag)) return false;
    for (let item of tag) {
      if (typeof item === 'object') return false;
    }
  }

  return true;
}

export class RelayManager {
    constructor(storageDir, bootstrap, rl) {
      this.storageDir = storageDir;
      this.bootstrap = bootstrap;
      this.store = new Corestore(storageDir);
      this.relay = null;
      this.swarm = null;
      this.rl = rl;
      this.wss = null;
    }
  
    async initialize() {
      console.log('bootstrap', this.bootstrap);
  
      this.relay = new NostrRelay(this.store, this.bootstrap, {
        apply: async (batch, view, base) => {
          for (const node of batch) {
            const op = node.value;
            if (op.type === 'addWriter') {
              console.log('\rAdding writer', op.key);
              await base.addWriter(b4a.from(op.key, 'hex'));
              continue;
            }
          }
          await NostrRelay.apply(batch, view, base);
        },
        valueEncoding: c.any,
        verifyEvent: this.verifyEvent.bind(this)
      });

    this.relay.on('error', console.error);

    await this.relay.update();

    this.relay.view.core.on('append', async () => {
      if (this.relay.view.version === 1) return;
      console.log('\rCurrent relay events:');
      for await (const node of this.relay.createReadStream()) {
        console.log('ID:', node.key);
        console.log('Event:', node.value);
        console.log();
      }
      this.rl.prompt();
    });

    if (!this.bootstrap) {
      console.log('relay.key', b4a.toString(this.relay.key, 'hex'));
    }

    this.swarm = new Hyperswarm();
    this.setupSwarmListeners();

    console.log('Joining swarm with discovery key:', b4a.toString(this.relay.discoveryKey, 'hex'));
    const discovery = this.swarm.join(this.relay.discoveryKey);
    await discovery.flushed();

    console.log('Initializing relay');
    if (this.relay.writable) {
      try {
        const initEventId = await this.initRelay();
        console.log('Relay initialized with event ID:', initEventId);
      } catch (error) {
        console.error('Failed to initialize relay:', error);
      }
    } else {
      console.log('Relay isn\'t writable yet');
      console.log('Have another writer add the following key:');
      console.log(b4a.toString(this.relay.local.key, 'hex'));
    }

    this.printAvailableCommands();

    return this;
  }

  setupSwarmListeners() {
    this.swarm.on('connection', async (connection, peerInfo) => {
      console.log('\rPeer joined', b4a.toString(peerInfo.publicKey, 'hex').substring(0, 4));
      
      const mux = new Protomux(connection);
      console.log('Initialized Protomux on the connection');
      
      const addWriterProtocol = mux.createChannel({
        protocol: 'add-writer',
        onopen: () => {
          console.log('add-writer protocol opened!');
        },
        onclose: () => {
          console.log('add-writer protocol closed!');
        }
      });
      
      if (!addWriterProtocol) {
        console.error('Failed to create add-writer protocol channel');
        return;
      }
      
      const addWriterMessage = addWriterProtocol.addMessage({
        encoding: c.string,
        onmessage: async (message) => {
          const writerKey = message.toString();
          console.log('Received new writer key:', writerKey);
          try {
            await this.addWriter(writerKey);
            await this.relay.update();
            console.log('Writer key added successfully');
            addWriterProtocol.close();
          } catch (error) {
            console.error('Error adding writer key:', error);
          }
        }
      });
      
      addWriterProtocol.open();
      console.log('Opened add-writer protocol');
      
      const writerKey = b4a.toString(this.relay.local.key, 'hex');
      addWriterMessage.send(writerKey);
      console.log('Sent writer key:', writerKey);
      
      this.relay.replicate(connection);
      this.rl.prompt();
    });
  }

  async addWriter(key) {
    console.log('Adding writer:', key);
    return this.relay.append({
      type: 'addWriter',
      key
    });
  }

  async removeWriter(key) {
    console.log('Removing writer:', key);
    return await this.relay.append({
        type: 'removeWriter',
        key
    });
}

async handleMessage(message, sendResponse, connectionKey) {
  if (!this.relay) {
  throw new Error('Relay not initialized');
  }
  return this.relay.handleMessage(message, sendResponse, connectionKey);
}

async handleSubscription(connectionKey) {
  if (!this.relay) {
  throw new Error('Relay not initialized');
  }
  return this.relay.handleSubscription(connectionKey);
}        

async updateSubscriptions(connectionKey, activeSubscriptionsUpdated) {
  try {
      if (!this.relay) {
          throw new Error('Relay not initialized');
      }
      
      console.log(`[${new Date().toISOString()}] RelayManager: Updating subscriptions for connection ${connectionKey}`);
      console.log('Updated subscription data:', JSON.stringify(activeSubscriptionsUpdated, null, 2));
      
      const result = await this.relay.updateSubscriptions(connectionKey, activeSubscriptionsUpdated);
      console.log(`[${new Date().toISOString()}] RelayManager: Successfully updated subscriptions`);
      
      return result;
  } catch (error) {
      console.error(`[${new Date().toISOString()}] RelayManager: Error updating subscriptions:`, error);
      throw error;
  }
}


  initRelay() {
    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey);
  
    const event = {
      kind: 0,
      content: 'Relay initialized',
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      pubkey: bytesToHex(publicKey).slice(2), // Remove the '02' or '03' prefix
    };
  
    const serializedEvent = serializeEvent(event);
    const eventHash = sha256(new TextEncoder().encode(serializedEvent));
    event.id = bytesToHex(eventHash);
    
    const signature = schnorr.sign(eventHash, privateKey);
    event.sig = bytesToHex(signature);
  
    console.log('Initialized event (before publishing):', JSON.stringify(event, null, 2));
    console.log('Serialized event:', serializedEvent);
    console.log('Event hash:', event.id);
  
    return this.relay.publishEvent(event);
  }

  async listAllEvents() {
    let count = 0;
    for await (const node of this.relay.createReadStream()) {
      try {
        const event = JSON.parse(node.value);
        console.log('Event ID:', node.key.toString('hex'));
        console.log('Event:', event);
        console.log('---');
        count++;
      } catch (error) {
        console.error('Error parsing event:', error);
      }
    }
    console.log(`Total events: ${count}`);
  }

  // Update the verifyEvent method:
    verifyEvent(event) {
        return validateEvent(event) && verifyEventSignature(event);
    }

  async publishEvent(event) {
    if (!this.relay) {
      throw new Error('Relay not initialized');
    }
    
    if (!validateEvent(event)) {
      throw new Error('Invalid event format');
    }
  
    return await this.relay.publishEvent(event);
  }

  printAvailableCommands() {
    console.log(`\nNOSTR Relay Commands:
    - publish <event_json>: Publish a new event
    - get <event_id>: Retrieve an event by ID
    - query <filters_json>: Query events using NOSTR filters
    - delete <event_id>: Delete an event (note: this is not standard NOSTR behavior)
    - addWriter <key>: Add a new writer to the relay
    - list or all: Retrieve all events from the relay
    - exit: Exit the program

    Enter a command:`);
  }

  async handleCommand(line) {
    const [command, ...args] = line.trim().split(' ');

    try {
      switch (command) {
        case 'publish':
          const eventJson = args.join(' ');
          const event = JSON.parse(eventJson);
          const publishedId = await this.relay.publishEvent(event);
          console.log('Event published successfully with ID:', publishedId);
          break;

        case 'get':
          const getEventId = args[0];
          const retrievedEvent = await this.relay.getEvent(getEventId);
          if (retrievedEvent) {
            console.log('Retrieved event:', JSON.stringify(retrievedEvent, null, 2));
          } else {
            console.log('Event not found');
          }
          break;

        case 'query':
          const filtersJson = args.join(' ');
          const filters = JSON.parse(filtersJson);
          const events = await this.relay.queryEvents(filters);
          console.log('Matching events:', events);
          break;

        case 'delete':
          const deleteEventId = args[0];
          await this.relay.deleteEvent(deleteEventId);
          console.log('Event deleted (Note: this is not standard NOSTR behavior)');
          break;

        case 'addWriter':
          const writerKey = args[0];
          await this.addWriter(writerKey);
          console.log('Writer added successfully');
          break;

        case 'list':
        case 'all':
          console.log('Retrieving all events...');
          await this.listAllEvents();
          break;

        default:
          console.log('Unknown command. Available commands: publish, get, query, delete, addWriter, list, all');
      }
    } catch (error) {
      console.error('Error executing command:', error);
    }
  }

  getPublicKey() {
    return b4a.toString(this.relay.key, 'hex');
  }

  async flushSubscriptionQueue(subscriptionId) {
    return await this.relay.flushSubscriptionQueue(subscriptionId);
}

  async close() {
    if (this.relay) {
      await this.relay.close();
    }
    if (this.swarm) {
      await this.swarm.destroy();
    }
    if (this.wss) {
      this.wss.close();
    }
  }
}
