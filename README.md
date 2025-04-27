# hypertuna-relay-server
a simple p2p NOSTR relay implementation built on the Pear stack

**Note:**

- This module is an ongoing work-in-progress to be used as part of a larger integrated application, but I'd like to make the current proof-of-concept state available to any NOSTR / Pear builders who may be interested. Feel free to fork, provide feedback / improvements, or use in your project if useful.
- the Hypertuna Proxy Server that this module interfaces with is currently optimized for use on a VPS with a registered domain / encryption certs. using this relay server module with a local instance of Hypertuna Proxy Server is currently for experimental use.


**Set-Up:**

1. `git clone https://github.com/squip/hypertuna-relay-server`
2. `npm install`
3. make sure you have the Hypertuna Proxy Server installed and running in a separate terminal
   - follow install / set-up instructions here: https://github.com/squip/hypertuna-proxy-server
5. once proxy server is initialized / running, initialize the Hypertuna Relay Server
   - run `node hypertuna-start-relay-server.mjs` - this will initialize the relay server instance and establish a connection with your Hypertuna Proxy Server.
6. once relay server is initialized / running, the CLI will present 2 main commands:
   - `create-relay` 
   - `join-relay <relayKey>`
7. the `create-relay` command will initialize a new Hypertuna Relay Instance, and produce a relayKey and wss url pointing to your relay instance (i.e. `wss://127.0.0.1:8443/<relayKey>`)
  - the CLI will then prompt the user to enter a name and description for your relay. 

# HyperTuna Relay System Documentation

## Introduction

The HyperTuna Relay system is a distributed peer-to-peer networking solution that enables nodes to create and join NOSTR protocol relays. Each node can initialize a local NOSTR relay instance that can be replicated, synced, and updated by other peers on the network using the relay's unique key. The system combines several technologies:

- **NOSTR protocol** for event-based communication
- **Hyperswarm** for peer discovery and connectivity
- **Autobase/Hyperbee** for distributed database functionality
- **Corestore** for managing storage

## Class Hierarchy Overview

The HyperTuna Relay system follows a hierarchical class structure with clear inheritance patterns:

```
EventEmitter
  └── ReadyResource
       └── Autobase
            └── Autobee (./hypertuna-relay-helper.mjs)
                 └── NostrRelay (./hypertuna-relay-event-processor.mjs)
                      └── Used by RelayManager (./hypertuna-relay-manager.mjs)
```

Each layer in this hierarchy adds specific functionality to the system:

1. **EventEmitter**: Provides the event handling foundation
2. **ReadyResource**: Adds lifecycle management (open/close operations)
3. **Autobase**: Implements distributed database core functionality and consensus
4. **Autobee**: Extends Autobase with Hyperbee integration for key-value storage
5. **NostrRelay**: Adds NOSTR protocol-specific event processing and subscription handling
6. **RelayManager**: Coordinates the creation, joining, and management of relay instances

## Core Classes

### 1. RelayManager Class
**File**: `hypertuna-relay-manager.mjs`

**Purpose**: Acts as the primary interface for creating, joining, and managing relay nodes. It coordinates interactions between system components, handles peer connections, and provides a user interface for relay operations.

**Key Properties**:
- `storageDir`: Directory for storing relay data
- `bootstrap`: Optional key for connecting to an existing relay
- `store`: Corestore instance for data storage
- `relay`: The managed NostrRelay instance
- `swarm`: Hyperswarm instance for peer discovery and connectivity
- `rl`: Readline interface for user interaction
- `wss`: WebSocket server for client connections

**Key Methods**:
- `initialize()`: Sets up the relay environment, creates a NostrRelay instance, and joins the Hyperswarm network
- `setupSwarmListeners()`: Configures peer connection handlers for writer key exchange
- `addWriter(key)`: Adds a new writer to the relay
- `removeWriter(key)`: Removes a writer from the relay
- `handleMessage(message, sendResponse, connectionKey)`: Processes messages from clients
- `handleSubscription(connectionKey)`: Manages subscriptions
- `getPublicKey()`: Returns the relay's public key
- `close()`: Shuts down the relay and its components

### 2. NostrRelay Class
**File**: `hypertuna-relay-event-processor.mjs`

**Purpose**: Handles NOSTR protocol-specific operations, processes events, and manages client subscriptions. It extends Autobee to provide distributed database functionality with NOSTR-specific enhancements.

**Key Properties**:
- Inherits properties from Autobee and Autobase
- `verifyEvent`: Function to validate event signatures and structure
- `subscriptions`: Map of active subscriptions
- `bootstrap`: Buffer containing the bootstrap relay key when joining an existing relay
- `valueEncoding`: Encoding configuration for the database

**Key Methods**:
- `publishEvent(event)`: Adds a new event to the relay's database, validates it, and propagates to peers
- `queryEvents(filter)`: Searches for events matching specified criteria
- `handleSubscription(connectionKey)`: Processes subscription requests
- `getSubscriptions(connectionKey)`: Retrieves active subscriptions
- `updateSubscriptions(connectionKey, activeSubscriptionsUpdated)`: Updates subscription data
- `handleMessage(message, sendResponse, connectionKey)`: Routes client messages to appropriate handlers
- `executeIdQueries(filter)`: Performs queries based on event IDs
- `executeQueries(queries)`: Executes database queries
- `findCommonIds(queryResults)`: Identifies matching events across queries
- `constructIndexKeyKind(event)`: Creates composite keys for efficient event indexing
- `constructIndexKeyPubkey(event)`: Creates pubkey-based index keys
- `constructIndexKeyTagKey(event, tagName, tagValue)`: Creates tag-based index keys

### 3. Autobee Class
**File**: `hypertuna-relay-helper.mjs`

**Purpose**: Extends Autobase to provide distributed database functionality with Hyperbee integration. It adds methods for key-value database operations.

**Key Properties**:
- Inherits properties from Autobase
- `subscriptions`: Map of active subscriptions
- `cleanupInterval`: Timer for subscription cleanup

**Key Methods**:
- `cleanupSubscriptions()`: Removes inactive subscriptions
- `put(key, value, opts)`: Stores data in the database
- `del(key, opts)`: Removes data from the database
- `get(key, opts)`: Retrieves data from the database
- `createReadStream(range, opts)`: Creates a readable stream of database entries
- `_getEncodedKey(key, opts)`: Encodes keys for storage
- `append(value)`: Adds an operation to the distributed log

## Key Workflows

### 1. Creating a New Relay

The `createRelay()` workflow involves these steps:

1. **Storage Initialization**:
   - Create a storage directory
   - Initialize a Corestore instance for data persistence

2. **RelayManager Creation**:
   - Instantiate RelayManager with storage directory
   - Set up readline interface for user interaction

3. **NostrRelay Initialization**:
   - Create NostrRelay instance with the storage
   - Configure event verification and validation
   - Set up the database views
   - Generate encryption keys for the relay

4. **Hyperswarm Setup**:
   - Initialize peer discovery with the relay's discovery key (derived from public key)
   - Configure peer connection handlers
   - Join the swarm with the relay's discovery key (seen in logs: `relay.key ec6ca8cec9f83572bbb558de5b4a1b7112909af70b18cf3b3097de99b1fd248c` followed by `Joining swarm with discovery key: c61f44965add75a80e6903d2c469446edaf5d481107e3cb5add469c7202f1f40`)

5. **Relay Bootstrap**:
   - Generate an initial NOSTR event to mark relay creation
   - The event includes kind, content, timestamp, tags, pubkey, and signature
   - The event is signed and verified (as seen in logs: `[INFO] verifyEventSignature: Signature verification result: true`)
   - Store the event in the database with multiple index entries (logs show entries for ID, created_at, kind, and pubkey)

6. **Writer Configuration**:
   - Set up a local writer for the relay
   - Configure writer key exchange mechanism through Protomux channels
   - Allow other peers to add writers using the `addWriter` protocol

The result is a new relay with a unique public key that other peers can use to join.

### 2. Joining an Existing Relay

The `joinRelay()` workflow involves these steps:

1. **Bootstrap Key Acquisition**:
   - Obtain the public key of an existing relay to join
   - In logs: `Using relay key: ec6ca8cec9f83572bbb558de5b4a1b7112909af70b18cf3b3097de99b1fd248c`

2. **Storage Initialization**:
   - Create a storage directory for the joining relay
   - Initialize a Corestore instance

3. **RelayManager Creation with Bootstrap Key**:
   - Instantiate RelayManager with storage directory and bootstrap key
   - Set up readline interface for user interaction

4. **NostrRelay Initialization with Bootstrap**:
   - Create NostrRelay instance with the bootstrap key
   - Use the key to identify the target relay to join

5. **Hyperswarm Connection**:
   - Join the swarm using the same discovery key as the bootstrap relay
   - In logs: `Joining swarm with discovery key: c61f44965add75a80e6903d2c469446edaf5d481107e3cb5add469c7202f1f40`
   - Discover and connect to peers in the relay network
   - Logs show this in action: `Peer joined bcbb` and `Initialized Protomux on the connection`

6. **Writer Key Exchange**:
   - Exchange writer keys with the original relay
   - Logs show this bidirectional exchange:
     - `Sent writer key: 30467af8a6f332738d8760422aa1d7adcb216975a6c3154a90699b3563ce2976`
     - `Received new writer key: ec6ca8cec9f83572bbb558de5b4a1b7112909af70b18cf3b3097de99b1fd248c`

7. **Data Replication**:
   - Begin replicating the database from the original relay
   - Apply existing events to the local database
   - Logs show this happening: `[INFO] validateEvent: Validating event` followed by storage operations

8. **Initialize and Publish**:
   - The joining relay also initializes itself by publishing a new event
   - This event is added to both relay databases, demonstrating bidirectional replication

The result is a new peer node that shares the same relay key and database with the existing relay, creating a distributed network.

## Data Flow Diagrams

### Event Publishing Flow

```
Client
  │
  ▼
RelayManager.handleMessage()
  │
  ▼
NostrRelay.publishEvent()
  │
  ▼
Verify Event (validate structure and signature)
  │      ┌─ [INFO] validateEvent: Validating event
  │      └─ [INFO] verifyEventSignature: Signature verification result: true
  ▼
Autobee.append() (add to distributed log)
  │
  ▼
NostrRelay.apply() (process batch operations)
  │      ┌─ [INFO] NostrRelay.apply: Applying batch
  │      └─ [INFO] NostrRelay.apply: Storing event with ID: ...
  ▼
Hyperbee.put() (store in database with indexes)
  │      Creates multiple index entries:
  │      ├─ Direct ID lookup
  │      ├─ Kind-based index
  │      ├─ Pubkey-based index
  │      └─ Created_at-based index
  ▼
Replicate to other peers
```

### Writer Key Exchange Flow

```
Original Relay                                     Joining Relay
      │                                                 │
      │◄───────────Hyperswarm Connection───────────────►│
      │                                                 │
      │◄──────Initialize Protomux Channel──────────────►│
      │                                                 │
      │◄──────Open "add-writer" Protocol Channel───────►│
      │                                                 │
      │                Send local writer key            │
      │◄────────────────────────────────────────────────│
      │  "Sent writer key: 30467af...63ce2976"          │
      │                                                 │
      │           Send original writer key              │
      │─────────────────────────────────────────────────►│
      │          "Received new writer key: ec6ca8c..."   │
      │                                                 │
      │◄─────────"Adding writer: 30467af..."───────────│
      │                                                 │
      │──────────"Adding writer: ec6ca8c..."───────────►│
      │                                                 │
      │◄──────────Close Protocol Channel───────────────►│
      │                                                 │
      │◄──────Begin Database Replication───────────────►│
```

## System Interactions

### Peer Discovery and Connection

1. **Discovery**:
   - Relays use Hyperswarm to discover peers using the relay's discovery key
   - The discovery key is derived from the relay's public key
   - In logs: `relay.key ec6ca8cec9f83572bbb558de5b4a1b7112909af70b18cf3b3097de99b1fd248c` gives `discovery key: c61f44965add75a80e6903d2c469446edaf5d481107e3cb5add469c7202f1f40`

2. **Connection Establishment**:
   - Peers connect using the relay's discovery key
   - Protomux channels are created for different types of communication
   - In logs: `Initialized Protomux on the connection` followed by `Opened add-writer protocol`

3. **Writer Key Exchange**:
   - Each peer sends its writer key to the other
   - The relays add each other's writer keys to their authorization lists
   - In logs: `Adding writer: 30467af8a6f332738d8760422aa1d7adcb216975a6c3154a90699b3563ce2976`

### Data Replication and Synchronization

1. **Event Propagation**:
   - New events are stored in the local database with multiple index entries
   - The indexed structure helps with efficient NOSTR event querying
   - Events are propagated to peers through replication

2. **Indexing Strategy**:
   - Events are indexed by multiple properties:
     - Direct ID lookup: Raw event ID as key 
     - Kind-based: `kind:<padded-kind>:created_at:<timestamp>:id:<event-id>`
     - Pubkey-based: `pubkey:<pubkey>:created_at:<padded-timestamp>:id:<event-id>`
     - Time-based: `created_at:<padded-timestamp>:id:<event-id>`
     - Tag-based: `tagKey:<tagName>:tagValue:<tagValue>:created_at:<padded-timestamp>:id:<event-id>`

3. **Consistency**:
   - Autobase handles consistency across peers
   - Writer authorization ensures only valid peers can modify data
   - Both relays end up with identical database content

## Working with the Code

### Key Implementation Patterns

1. **Event Lifecycle**:
   - Event creation: Generate event with kind, content, timestamp, tags, pubkey
   - Event signing: Sign the serialized event with the private key
   - Event verification: Verify signature and validate structure
   - Event storage: Store with multiple indexes for efficient querying
   - Event replication: Propagate to connected peers

2. **Database Indexing**:
   - Multi-component composite keys
   - Time-based indexing for efficient temporal queries
   - Range queries for filtering events

3. **Peer Networking**:
   - Discovery via Hyperswarm
   - Connection management with automatic peer handling
   - Protocol-specific channels via Protomux

### Performance Considerations

1. **Index Optimization**:
   - Composite keys enable efficient range queries
   - Prefix-based keys allow for partial lookups
   - The padding of numeric values (like timestamps and kinds) ensures correct lexicographic ordering

2. **Connection Management**:
   - Peer connections are handled automatically
   - Writer keys control write access to the database
   - Automatic data synchronization between peers

### Error Handling

1. **Event Validation**:
   - Structure validation: Ensures events conform to NOSTR specification
   - Signature verification: Prevents tampering with events
   - In logs: `[INFO] validateEvent: Event passed all validation checks` followed by `[INFO] verifyEventSignature: Signature verification result: true`

2. **Connection Resilience**:
   - Automatic reconnection to peers
   - Graceful handling of peer disconnections
   - Writer key persistence for long-term authorization

## Extending the System

### Adding Custom Event Types

To add support for new NOSTR event kinds:

1. Ensure the `validateEvent()` function accepts the new kind
2. Add appropriate indexing in `constructIndexKeyKind()` if needed
3. Update query processing to handle the new kind
4. Add any kind-specific processing in the event handlers

### Implementing Custom Storage Solutions

To customize the storage backend:

1. Modify the Autobee class to use a different storage engine
2. Update the key encoding/decoding methods
3. Implement custom batch operations if needed
4. Ensure consistent replication semantics

## Troubleshooting Guide

### Common Issues

1. **Connection Problems**:
   - Verify that the discovery key derivation is consistent between relays
   - Ensure network connectivity between peers
   - Check that the Hyperswarm DHT is accessible

2. **Synchronization Issues**:
   - Confirm writer keys are properly exchanged and added
   - Verify that the bootstrap key is correct when joining
   - Check for data corruption in the database

3. **Event Publication Failures**:
   - Validate event structure before publication
   - Ensure signature generation is working correctly
   - Check writer authorization for the publishing peer

### Diagnostic Tools

1. **Logging**:
   - The system uses a comprehensive logging system
   - Different log levels for debugging, info, warning, and error
   - Component-specific logs help isolate issues

2. **Database Inspection**:
   - The `list` or `all` commands show all events in the database
   - The `get <event_id>` command retrieves a specific event
   - The `query <filters_json>` command allows for complex queries

## summary

The HyperTuna Relay system provides an effective framework for building distributed NOSTR relay networks. The combination of NOSTR protocol with distributed database technology creates a resilient, decentralized messaging infrastructure. The clear class hierarchy and well-defined workflows make the system maintainable and extensible.

Key strengths of the system include:
1. Decentralized architecture with no single point of failure
2. Efficient event indexing for quick queries
3. Secure writer authorization through key exchange
4. Automatic peer discovery and network formation
5. Standard NOSTR protocol compatibility

With this documentation, you should have a comprehensive understanding of the system's structure, operation, and implementation details, enabling you to maintain and extend it effectively.
