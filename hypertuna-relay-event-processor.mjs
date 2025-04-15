// this is the script for /sashimi-ahi-relay-event-processor.mjs

import Autobee from './hypertuna-relay-helper.mjs';
import b4a from 'b4a';
import { randomBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import fs from 'fs';
import path from 'path';
export { validateEvent, verifyEventSignature, getEventHash, serializeEvent };

// Configuration for logging
const LOG_CONFIG = {
  logFilePath: process.env.RELAY_LOG_PATH || './logs/relay-operations.log',
  consoleOutput: process.env.CONSOLE_OUTPUT === 'false' || true,
  logLevel: process.env.LOG_LEVEL || 'info' // Possible values: debug, info, warn, error
};

// Create logs directory if it doesn't exist
const logDir = path.dirname(LOG_CONFIG.logFilePath);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Log levels and their priority
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function log(message, ...args) {
  const timestamp = new Date().toISOString();
  const formattedArgs = args.map(arg => {
    if (typeof arg === 'object') {
      return JSON.stringify(arg);
    }
    return arg;
  }).join(' ');
  
  const logMessage = `[${timestamp}] ${message} ${formattedArgs}`.trim();
  
  // Write to log file
  fs.appendFileSync(LOG_CONFIG.logFilePath, logMessage + '\n');
  
  // Optional console output
  if (LOG_CONFIG.consoleOutput) {
    console.log(logMessage);
  }
}

// Specialized log functions for different levels
function logDebug(message, ...args) {
  if (LOG_LEVELS[LOG_CONFIG.logLevel] <= LOG_LEVELS.debug) {
    log(`[DEBUG] ${message}`, ...args);
  }
}

function logInfo(message, ...args) {
  if (LOG_LEVELS[LOG_CONFIG.logLevel] <= LOG_LEVELS.info) {
    log(`[INFO] ${message}`, ...args);
  }
}

function logWarn(message, ...args) {
  if (LOG_LEVELS[LOG_CONFIG.logLevel] <= LOG_LEVELS.warn) {
    log(`[WARN] ${message}`, ...args);
  }
}

function logError(message, ...args) {
  if (LOG_LEVELS[LOG_CONFIG.logLevel] <= LOG_LEVELS.error) {
    log(`[ERROR] ${message}`, ...args);
  }
}

function serializeEvent(event) {
  logDebug("serializeEvent: Serializing event", event);
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  logDebug("serializeEvent: Serialized event", serialized);
  return serialized;
}

function getEventHash(event) {
  logDebug("getEventHash: Generating hash for event", event);
  const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
  const hash = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  logDebug("getEventHash: Generated hash", hash);
  return hash;
}

function validateEvent(event) {
  logInfo('validateEvent: Validating event:', JSON.stringify(event, null, 2));
  
  if (!event.id) {
    logWarn('validateEvent: Event is missing id');
    return false;
  }
  if (!event.pubkey) {
    logWarn('validateEvent: Event is missing pubkey');
    return false;
  }
  if (!event.pubkey.match(/^[a-f0-9]{64}$/)) {
    logWarn('validateEvent: Event pubkey is not a valid 32-byte hex string');
    return false;
  }
  if (!event.created_at) {
    logWarn('validateEvent: Event is missing created_at');
    return false;
  }
  if (event.kind === undefined) {
    logWarn('validateEvent: Event is missing kind');
    return false;
  }
  if (!Array.isArray(event.tags)) {
    logWarn('validateEvent: Event tags is not an array');
    return false;
  }
  if (typeof event.content !== 'string') {
    logWarn('validateEvent: Event content is not a string');
    return false;
  }
  if (!event.sig) {
    logWarn('validateEvent: Event is missing signature');
    return false;
  }

  if (typeof event.kind !== 'number') {
    logWarn('validateEvent: Event kind is not a number');
    return false;
  }
  if (typeof event.created_at !== 'number') {
    logWarn('validateEvent: Event created_at is not a number');
    return false;
  }
  if (!event.pubkey.match(/^[a-f0-9]{64}$/)) {
    logWarn('validateEvent: Event pubkey is not a valid 32-byte hex string');
    return false;
  }

  for (let tag of event.tags) {
    if (!Array.isArray(tag)) {
      logWarn('validateEvent: Event tag is not an array');
      return false;
    }
    for (let item of tag) {
      if (typeof item === 'object') {
        logWarn('validateEvent: Event tag item is an object');
        return false;
      }
    }
  }

  logInfo('validateEvent: Event passed all validation checks');
  return true;
}

function verifyEventSignature(event) {
  logInfo('verifyEventSignature: Verifying event signature');
  logDebug('verifyEventSignature: Event ID:', event.id);
  logDebug('verifyEventSignature: Event pubkey:', event.pubkey);
  logDebug('verifyEventSignature: Event signature:', event.sig);
  
  try {
    const serializedEvent = serializeEvent(event);
    const eventHash = sha256(new TextEncoder().encode(serializedEvent));
    logDebug('verifyEventSignature: Serialized event:', serializedEvent);
    logDebug('verifyEventSignature: Event hash:', bytesToHex(eventHash));
    
    const publicKey = hexToBytes(event.pubkey);
    const signature = hexToBytes(event.sig);
    
    logDebug('verifyEventSignature: Public key (hex):', bytesToHex(publicKey));
    logDebug('verifyEventSignature: Signature (hex):', bytesToHex(signature));
    
    const isValid = schnorr.verify(signature, eventHash, publicKey);
    logInfo('verifyEventSignature: Signature verification result:', isValid);
    return isValid;
  } catch (error) {
    logError('verifyEventSignature: Error verifying event signature:', error);
    return false;
  }
}

export default class NostrRelay extends Autobee {
    constructor(store, bootstrap, handlers = {}) {
      super(store, bootstrap, handlers);
      this.verifyEvent = handlers.verifyEvent || this.defaultVerifyEvent.bind(this);
      this.executeIdQueries = this.executeIdQueries.bind(this);
      this.findCommonIds = this.findCommonIds.bind(this);
      logInfo('NostrRelay: Initialized');
    }
  
  defaultVerifyEvent(event) {
    logInfo('defaultVerifyEvent: Verifying event', event);
    const result = validateEvent(event) && verifyEventSignature(event);
    logInfo('defaultVerifyEvent: Verification result', result);
    return result;
  }

  static async apply(batch, view, base) {
    logInfo('NostrRelay.apply: Applying batch');
    const b = view.batch({ update: false })
  
    for (const node of batch) {
        const op = node.value;
        if (op.type === 'event') {
            const event = JSON.parse(op.event);
            if (validateEvent(event) && verifyEventSignature(event)) {
                // Store the full event under its ID
                const eventKey = b4a.from(event.id, 'hex');
                logInfo(`NostrRelay.apply: Storing event with ID: ${event.id}`);
                await b.put(eventKey, op.event);

                // Store index references - store just the event ID
                const kindKey = NostrRelay.constructIndexKeyKind(event);
                logDebug(`NostrRelay.apply: Storing kind index for event ${event.id} under key: ${kindKey}`);
                await b.put(b4a.from(kindKey, 'utf8'), event.id);

                const pubkeyKey = NostrRelay.constructIndexKeyPubkey(event);
                logDebug(`NostrRelay.apply: Storing pubkey index for event ${event.id} under key: ${pubkeyKey}`);
                await b.put(b4a.from(pubkeyKey, 'utf8'), event.id);

                const createdAtKey = NostrRelay.constructIndexKeyCreatedAt(event);
                logDebug(`NostrRelay.apply: Storing created_at index for event ${event.id} under key: ${createdAtKey}`);
                await b.put(b4a.from(createdAtKey, 'utf8'), event.id);

                // Store tag references
                for (const tag of event.tags) {
                    if (tag.length >= 2 && /^[a-zA-Z]$/.test(tag[0])) {
                        const tagKey = NostrRelay.constructIndexKeyTagKey(event, tag[0], tag[1]);
                        logDebug(`NostrRelay.apply: Storing tag index for event ${event.id} under key: ${tagKey}`);
                        await b.put(b4a.from(tagKey, 'utf8'), event.id);
                    }
                }
            } else {
                logWarn(`NostrRelay.apply: Invalid event, not storing. ID: ${event.id}`);
            }
        } else if (op.type === 'subscriptions') {
            const subscriptionData = JSON.parse(op.subscriptions);
            logInfo('NostrRelay.apply: Processing subscription data:', subscriptionData);
            const key = b4a.from(subscriptionData.connection, 'hex');
            logInfo(`NostrRelay.apply: Storing subscription data for connection: ${subscriptionData.connection}`);
            await b.put(key, op.subscriptions);
        }
    }
  
    logInfo('NostrRelay.apply: Flushing batch');
    await b.flush();
}

  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // PROCESSES TO <PUBLISH> EVENTS TO HYPERBEE: ///////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////

  // helper functions to be used by NostrRelay.apply() method to create searchable composite keys when publishing each hyperbee event entry


  static constructIndexKeyId(event) {
    return event.id;
  }

  static constructIndexKeyKind(event) {
    return `kind:${NostrRelay.padNumber(event.kind, 5)}:created_at:${event.created_at}:id:${event.id}`;
  }

  static constructIndexKeyPubkey(event) {
    return `pubkey:${event.pubkey}:created_at:${NostrRelay.padTimestamp(event.created_at)}:id:${event.id}`;
  }

  // ENHANCEMENT: logic is required to extract element 1 from each tag array and pass to 
  static constructIndexKeyTagKey(event, tagName, tagValue) {
    return `tagKey:${tagName}:tagValue:${tagValue}:created_at:${NostrRelay.padTimestamp(event.created_at)}:id:${event.id}`;
  }

  static constructIndexKeyCreatedAt(event) {
    return `created_at:${NostrRelay.padTimestamp(event.created_at)}:id:${event.id}`;
  }

  static padNumber(num, length) {
    return num.toString().padStart(length, '0');
  }

  // function to verify event object structure and attributes are valid + append valid event objects to hyperbee log
  // note: apply() method will take objects appended to hyperbee log + handle the final processes to 'put' new entries into the db.
  async publishEvent(event) {
    logInfo('publishEvent: Attempting to publish event:', JSON.stringify(event, null, 2));
    
    if (!this.writable) {
      logError('publishEvent: Error - Not writable');
      throw new Error('Not writable');
    }
    
    if (!event.id) {
      event.id = getEventHash(event);
      logInfo('publishEvent: Generated event ID:', event.id);
    }
    
    const isValid = this.verifyEvent(event);
    logInfo('publishEvent: Event verification result:', isValid);
    
    if (isValid) {
      logInfo(`publishEvent: Publishing event with ID: ${event.id}`);
      try {
        const batch = [
          {
            type: 'event',
            event: JSON.stringify(event)
          },
          ...this.constructTagEntries(event)
        ];
        
        await this.append(batch);
        logInfo(`publishEvent: Event published successfully: ${event.id}`);
        return ["OK", event.id, true, ""];
      } catch (error) {
        logError(`publishEvent: Error publishing event: ${error.message}`);
        return ["ERROR", event.id, false, `Error publishing event: ${error.message}`];
      }
    } else {
      logWarn('publishEvent: Event failed verification');
      return ["OK", event.id, false, "invalid: event failed verification"];
    }
  }

    constructTagEntries(event) {
        const entries = [];
        for (const tag of event.tags) {
          if (tag.length >= 2 && /^[a-zA-Z]$/.test(tag[0])) {
            const tagKey = NostrRelay.constructIndexKeyTagKey(event, tag[0], tag[1]);
            entries.push({
              type: 'event',
              key: tagKey,
              event: JSON.stringify(event)
            });
          }
        }
        return entries;
      }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////


  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // PROCESS TO <DELETE> EVENT BY ID FROM HYPERBEE: ///////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////

  async deleteEvent(id) {
    logInfo(`deleteEvent: Deleting event with ID: ${id}`);
    if (!this.writable) {
      logError('deleteEvent: Error - Not writable');
      throw new Error('Not writable');
    }

    await this.append({
      type: 'delete',
      id: typeof id === 'string' ? id : b4a.toString(id, 'hex')
    });
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////

  /////////////////////////////////////////////////////////////////////////////////////////////////////////
  // PROCESS TO <GET> EVENT BY ID FROM HYPERBEE: //////////////////////////////////////////////////////////
  /////////////////////////////////////////////////////////////////////////////////////////////////////////  

  async getEvent(id) {
    logInfo(`getEvent: Attempting to retrieve event with ID: ${id}`);
    const key = b4a.from(id, 'hex');  // Direct conversion of ID to buffer
    logDebug(`getEvent: Converted key: ${key.toString('hex')}`);
    
    try {
        const event = await this.view.get(key);
        if (event) {
            logInfo(`getEvent: Event found for ID ${id}`);
            try {
                return typeof event.value === 'string' ? 
                       JSON.parse(event.value) : 
                       event.value;
            } catch (error) {
                logError('getEvent: Error parsing event:', error.message);
                return null;
            }
        }
        logInfo(`getEvent: No event found for ID ${id}`);
        return null;
    } catch (error) {
        logError('getEvent: Error retrieving event:', error.message);
        return null;
    }
}


  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  // PROCESSES TO <GET> EVENTS FROM HYPERBEE THAT MATCH SUBSCRIPTION FILTERS CRITERIA: //////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////////


  // Helper functions for query key construction
  static padNumber(num, length) {
    return num.toString().padStart(length, '0');
  }
  
  static padTimestamp(timestamp) {
    return timestamp.toString().padStart(10, '0');
  }
  
  async executeIdQueries(filter, last_returned_event_timestamp) {
    logInfo(`executeIdQueries: Processing ${filter.ids.length} IDs`);
    const results = [];
    const since = last_returned_event_timestamp || filter.since

    for (const id of filter.ids) {
      const event = await this.getEvent(id);
      
      if (!event) {
        logDebug(`executeIdQueries: Event not found for ID ${id}`);
        continue;
      }
  
      // Skip events older than last_returned_event_timestamp if it exists
      if (last_returned_event_timestamp && event.created_at < last_returned_event_timestamp) {
        logDebug(`executeIdQueries: Event ${id} skipped due to timestamp`);
        continue;
      }
  
      // Check if event matches additional filters
      let matches = true;
  
      // Check time-based filters
      if (filter.since && event.created_at < since) {
        matches = false;
      }
      if (filter.until && event.created_at > filter.until) {
        matches = false;
      }
  
      // Check kinds filter
      if (filter.kinds && !filter.kinds.includes(event.kind)) {
        matches = false;
      }
  
      // Check authors filter
      if (filter.authors && !filter.authors.includes(event.pubkey)) {
        matches = false;
      }
  
      // Check tag filters
      for (const [key, values] of Object.entries(filter)) {
        if (key.startsWith('#') && key.length === 2) {
          const tagName = key.slice(1);
          const matchingTags = event.tags.filter(tag => tag[0] === tagName);
          if (!matchingTags.some(tag => values.includes(tag[1]))) {
            matches = false;
            break;
          }
        }
      }
  
      if (matches) {
        results.push(event);
      }
    }

    if (filter.limit && !last_returned_event_timestamp) {
        results.splice(filter.limit);
        logInfo(`queryEvents: Results truncated to limit:`, filter.limit);
      }
  
    logInfo(`executeIdQueries: Found ${results.length} matching events`);
    return results;
  }

  async queryEvents(filter, last_returned_event_timestamp) {
    logInfo(`queryEvents: Starting query with filter:`, JSON.stringify(filter, null, 2));
    logInfo(`queryEvents: Last returned event timestamp:`, last_returned_event_timestamp);
    const queries = this.constructQueries(filter, last_returned_event_timestamp);
    logDebug(`queryEvents: Constructed queries:`, JSON.stringify(queries, null, 2));
    
    const results = await this.executeQueries(queries);
    logInfo(`queryEvents: Raw query results count:`, results.length);
    
    if (filter.limit && !last_returned_event_timestamp) {
      results.splice(filter.limit);
      logInfo(`queryEvents: Results truncated to limit:`, filter.limit);
    }
    
    return results;
  }
  
  constructQueries(filter, last_returned_event_timestamp) {
    logInfo(`constructQueries: Constructing queries for filter:`, JSON.stringify(filter, null, 2));
    logDebug(`constructQueries: Using timestamp:`, last_returned_event_timestamp ? 
        `last_returned_event_timestamp: ${last_returned_event_timestamp}` : 
        `filter.since: ${filter.since || 0}`);
    
    const queries = [];
  
    // Determine time range parameters - prioritize last_returned_event_timestamp over filter.since
    const since = last_returned_event_timestamp ? 
                 last_returned_event_timestamp + 1 : // Add 1 to exclude previously returned events
                 (filter.since || 0);
    const until = filter.until || 9999999999;
    
    logDebug(`constructQueries: Using time range - since: ${since}, until: ${until}`);
  
    // Case 1: Only time-based query (no other filters)
    if ((!filter.kinds || filter.kinds.length === 0) && 
        (!filter.authors || filter.authors.length === 0) && 
        !this.hasTagFilters(filter)) {
        const query = this.constructor.constructTimeRangeQuery(since, until);
        logDebug(`constructQueries: Constructed time-based query:`, query);
        queries.push(query);
        return queries;
    }
  
    // Case 2: Kinds-based queries
    if (filter.kinds && filter.kinds.length > 0) {
        for (const kind of filter.kinds) {
            const query = this.constructor.constructKindRangeQuery(kind, since, until);
            logDebug(`constructQueries: Constructed kind query for ${kind}:`, query);
            queries.push(query);
        }
    }
  
    // Case 3: Authors-based queries
    if (filter.authors && filter.authors.length > 0) {
        for (const author of filter.authors) {
            const query = this.constructor.constructAuthorRangeQuery(author, since, until);
            logDebug(`constructQueries: Constructed author query for ${author}:`, query);
            queries.push(query);
        }
    }
  
    // Case 4: Tag-based queries
    const tagQueries = this.constructTagQueries(filter, since, until);
    if (tagQueries.length > 0) {
        logDebug(`constructQueries: Adding ${tagQueries.length} tag-based queries`);
        queries.push(...tagQueries);
    }
  
    logInfo(`constructQueries: Constructed ${queries.length} total queries`);
    return queries;
}
  
  // Helper method to check if filter has tag-based filters
  hasTagFilters(filter) {
    return Object.keys(filter).some(key => key.startsWith('#') && key.length === 2);
  }


// Static methods for constructing specific range queries
  static constructTimeRangeQuery(since, until) {
    const gte = b4a.from(`created_at:${this.padTimestamp(since)}:id:`, 'utf8');
    const lte = b4a.from(`created_at:${this.padTimestamp(until)}:id:#`, 'utf8');
    return { gte, lte };
  }
  
  static constructKindRangeQuery(kind, since, until) {
    const paddedKind = this.padNumber(kind, 5);
    const gte = b4a.from(`kind:${paddedKind}:created_at:${this.padTimestamp(since)}:id:`, 'utf8');
    const lte = b4a.from(`kind:${paddedKind}:created_at:${this.padTimestamp(until)}:id:#`, 'utf8');
    return { gte, lte };
  }

  static constructAuthorRangeQuery(author, since, until) {
    const gte = b4a.from(`pubkey:${author}:created_at:${this.padTimestamp(since)}:id:`, 'utf8');
    const lte = b4a.from(`pubkey:${author}:created_at:${this.padTimestamp(until)}:id:#`, 'utf8');
    return { gte, lte };
  }
  
  constructTagQueries(filter, since, until) {
    const queries = [];
    
    for (const [key, values] of Object.entries(filter)) {
        if (key.startsWith('#') && key.length === 2) {
            const tagName = key.slice(1);
            for (const tagValue of values) {
                const query = this.constructor.constructTagRangeQuery(tagName, tagValue, since, until);
                logDebug(`constructTagQueries: Constructed query for tag ${tagName}=${tagValue}:`, query);
                queries.push(query);
            }
        }
    }
    
    logInfo(`constructTagQueries: Constructed ${queries.length} tag queries`);
    return queries;
}

  static constructTagRangeQuery(tagName, tagValue, since, until) {
    const gte = b4a.from(
      `tagKey:${tagName}:tagValue:${tagValue}:created_at:${this.padTimestamp(since)}:id:`, 
      'utf8'
    );
    const lte = b4a.from(
      `tagKey:${tagName}:tagValue:${tagValue}:created_at:${this.padTimestamp(until)}:id:#`, 
      'utf8'
    );
    return { gte, lte };
  }


async executeQueries(queries) {
    logInfo(`executeQueries: Starting execution of ${queries.length} queries`);
    
    if (!queries || queries.length === 0) {
        logWarn('executeQueries: No queries to execute');
        return [];
    }
    
    const queryResultIds = [];
    
    try {
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            logInfo(`executeQueries: Processing query ${i + 1}/${queries.length}`);
            
            const currentQueryIds = new Set();
            for await (const entry of this.view.createReadStream(query)) {
                if (!entry || !entry.value) continue;
                
                // The value should be the direct event ID
                const eventId = entry.value;
                currentQueryIds.add(eventId);
                logDebug(`executeQueries: Found ID: ${eventId}`);
            }
            
            queryResultIds.push(Array.from(currentQueryIds));
            logInfo(`executeQueries: Query ${i + 1} returned ${currentQueryIds.size} unique IDs`);
        }
        
        const commonIds = this.findCommonIds(queryResultIds);
        logInfo(`executeQueries: Found ${commonIds.size} common IDs across all queries`);
        
        const results = [];
        for (const id of commonIds) {
            try {
                const event = await this.getEvent(id);
                if (event) {
                    results.push(event);
                    logDebug(`executeQueries: Retrieved event for ID ${id}`);
                }
            } catch (error) {
                logError(`executeQueries: Error fetching event for ID ${id}:`, error.message);
            }
        }
        
        logInfo(`executeQueries: Successfully retrieved ${results.length} full events`);
        return results;
        
    } catch (error) {
        logError('executeQueries: Error during query execution:', error.message);
        throw error;
    }
}

findCommonIds(queryResults) {
    logInfo(`findCommonIds: Starting to process ${queryResults.length} query results`);
    
    if (!queryResults || !queryResults.length) {
        logWarn('findCommonIds: No query results to process');
        return new Set();
    }
    
    logDebug(`findCommonIds: Initial result set size: ${queryResults[0].length}`);
    const commonIds = new Set(queryResults[0]);
    
    if (!commonIds.size) {
        logWarn('findCommonIds: No IDs in first result set');
        return commonIds;
    }
    
    for (let i = 1; i < queryResults.length; i++) {
        if (commonIds.size === 0) {
            logInfo('findCommonIds: No common IDs remain, exiting early');
            return commonIds;
        }
        
        const currentSet = new Set(queryResults[i]);
        logDebug(`findCommonIds: Processing result set ${i + 1}, size: ${currentSet.size}`);
        
        const initialCommonSize = commonIds.size;
        for (const id of commonIds) {
            if (!currentSet.has(id)) {
                commonIds.delete(id);
            }
        }
        logInfo(`findCommonIds: After intersection with set ${i + 1}: reduced from ${initialCommonSize} to ${commonIds.size} common IDs`);
    }
    
    logInfo(`findCommonIds: Final common ID count: ${commonIds.size}`);
    return commonIds;
}

async handleSubscription(connectionKey) {
    logInfo(`handleSubscription: Handling subscription for connection: ${connectionKey}`);
    const activeSubscriptions = await this.getSubscriptions(connectionKey);
    if (!activeSubscriptions) {
        logInfo(`handleSubscription: No active subscriptions for connection: ${connectionKey}`);
        return [[], null];
    }

    logInfo(`handleSubscription: Active subscriptions:`, JSON.stringify(activeSubscriptions, null, 2));
    const eventsForClient = [];
    let activeSubscriptionsUpdated = JSON.parse(JSON.stringify(activeSubscriptions));

    for (const [subscriptionId, subscription] of Object.entries(activeSubscriptions.subscriptions)) {
        const last_returned_event_timestamp = subscription.last_returned_event_timestamp;
        logInfo(`handleSubscription: Processing subscription ${subscriptionId} with last timestamp: ${last_returned_event_timestamp}`);
        
        for (const filter of subscription.filters) {
            logDebug(`handleSubscription: Processing filter with last_returned_event_timestamp:`, last_returned_event_timestamp);
            
            let events;
            if (filter.ids && filter.ids.length > 0) {
                events = await this.executeIdQueries(filter, last_returned_event_timestamp);
            } else {
                events = await this.queryEvents(filter, last_returned_event_timestamp);
            }

            // Sort events by created_at in descending order
            if (events.length > 0) {
                events.sort((a, b) => b.created_at - a.created_at);
                const new_last_returned_event_timestamp = events[0].created_at;
                
                logInfo(`handleSubscription: Updating last_returned_event_timestamp for subscription ${subscriptionId}:`, {
                    previous: last_returned_event_timestamp,
                    new: new_last_returned_event_timestamp
                });
                
                activeSubscriptionsUpdated.subscriptions[subscriptionId].last_returned_event_timestamp = 
                    new_last_returned_event_timestamp;
                
                for (const event of events) {
                    eventsForClient.push(['EVENT', subscriptionId, event]);
                }
            }
        }
        eventsForClient.push(['EOSE', subscriptionId]);
    }
    
    logInfo(`handleSubscription: Total events and EOSE messages for client:`, eventsForClient.length);
    return [eventsForClient, activeSubscriptionsUpdated];
}

  ///////////////////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////////

  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////  
  // PROCESSES TO <GET> <PUBLISH> AND <UPDATE> SUBSCRIPTIONS TO HYPERBEE: ///////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

  async getSubscriptions(connectionKey) {
    logInfo(`getSubscriptions: Attempting to retrieve subscriptions for connectionKey: ${connectionKey}`);
    const key = b4a.from(connectionKey, 'hex');
    logDebug(`getSubscriptions: Converted key: ${key.toString('hex')}`);
    const subscriptionData = await this.view.get(key);
    if (subscriptionData) {
      logInfo(`getSubscriptions: Subscriptions found for connection ${connectionKey}: ${JSON.stringify(subscriptionData)}`);
      try {
        return typeof subscriptionData.value === 'string' ? JSON.parse(subscriptionData.value) : subscriptionData.value;
      } catch (error) {
        logError('getSubscriptions: Error parsing subscriptions:', error.message);
        return null;
      }
    } else {
      logInfo(`getSubscriptions: No subscriptions found for connection: ${connectionKey}`);
      return null;
    }
  }


async publishSubscription(connectionKey, reqMessage, activeSubscriptions = null) {
    logInfo('publishSubscription: Attempting to publish subscription:', JSON.stringify(reqMessage, null, 2));
    
    if (!this.writable) {
      logError('publishSubscription: Error - Not writable');
      throw new Error('Not writable');
    }
    
    const [, subscriptionId, ...filters] = reqMessage;
    
    if (!connectionKey || !subscriptionId || filters.length === 0) {
      logWarn('publishSubscription: Error - Invalid subscription parameters');
      return ['NOTICE', 'Error: Invalid subscription parameters'];
    }
    
    const isValid = this.validateFilters(filters);
    logInfo('publishSubscription: Filters validation result:', isValid);
    
    if (isValid) {
      let subscriptions = activeSubscriptions ? activeSubscriptions.subscriptions : {};
      
      // Create or update subscription with the new structure
      subscriptions[subscriptionId] = {
        last_returned_event_timestamp: undefined,
        filters: filters
      };
      
      const subscriptionObject = {
        connection: connectionKey,
        subscriptions: subscriptions
      };
      
      await this.append({
        type: 'subscriptions',
        subscriptions: JSON.stringify(subscriptionObject)
      });
      
      logInfo(`publishSubscription: Published subscription for connection: ${connectionKey}, subscriptionId: ${subscriptionId}`);
      return ['NOTICE', `Subscription ${subscriptionId} created/updated successfully`];
    } else {
      logWarn('publishSubscription: Invalid filters');
      return ['NOTICE', 'Error: Invalid filters'];
    }
  }

 async updateSubscriptions(connectionKey, activeSubscriptionsUpdated) {
    logInfo('updateSubscriptions: Updating subscriptions:', JSON.stringify(activeSubscriptionsUpdated, null, 2));
    
    if (!this.writable) {
      logError('updateSubscriptions: Error - Not writable');
      throw new Error('Not writable');
    }
    
    await this.append({
      type: 'subscriptions',
      subscriptions: JSON.stringify(activeSubscriptionsUpdated)
    });
    
    logInfo(`updateSubscriptions: Updated subscriptions for connection: ${connectionKey}`);
    return ['NOTICE', 'Subscriptions updated successfully'];
  }

  // helper function for publishSubscription() to verify that the structure and attributes of REQ 'filters' object 
  // conforms to NIP-01 specifications before appending subscription entry to hyperbee log.
  validateFilters(filters) {
    logInfo('validateFilters: Validating filters:', JSON.stringify(filters, null, 2));
    
    for (const filter of filters) {
      if (typeof filter !== 'object' || Object.keys(filter).length === 0) {
        logWarn('validateFilters: Invalid filter object');
        return false;
      }
      
      const validKeys = ['ids', 'authors', 'kinds', 'since', 'until', 'limit'];
      const hasValidKey = validKeys.some(key => filter.hasOwnProperty(key));
      
      if (!hasValidKey) {
        const tagKeys = Object.keys(filter).filter(key => /^#[a-zA-Z]$/.test(key));
        if (tagKeys.length === 0) {
          logWarn('validateFilters: Filter does not contain any valid keys');
          return false;
        }
      }
    }
    
    logInfo('validateFilters: All filters are valid');
    return true;
  }

  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // CORE PROCESS TO MANAGE INBOUND EVENT + REQ + CLOSE MESSAGES FROM NOSTR CLIENTS AND PUBLISH TO HYPERBEE: //// 
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

  // Update handleMessage to work with the new subscription structure
async handleMessage(message, sendResponse, connectionKey) {
    logInfo(`handleMessage: Received message:`, JSON.stringify(message, null, 2));
    try {
      const [type, ...params] = message;
  
      switch (type) {
        case 'EVENT':
          logInfo(`handleMessage: Processing EVENT message for client connection: ${connectionKey}`);
          const event = params[0];
          try {
            const publishResult = await this.publishEvent(event);
            logInfo(`handleMessage: EVENT publish result:`, JSON.stringify(publishResult, null, 2));
            sendResponse(publishResult);
          } catch (error) {
            logError(`handleMessage: Error publishing event: ${error.message}`);
            sendResponse(["ERROR", event.id, false, `Error publishing event: ${error.message}`]);
          }
          break;
  
        case 'REQ':
          logInfo(`handleMessage: Processing REQ message for client connection: ${connectionKey}`);
          const activeSubscriptions = await this.getSubscriptions(connectionKey);
          const publishSubResult = await this.publishSubscription(connectionKey, message, activeSubscriptions);
          logInfo(`handleMessage: REQ publish result:`, JSON.stringify(publishSubResult, null, 2));
          sendResponse(publishSubResult);
          break;
  
        case 'CLOSE':
          logInfo(`handleMessage: Processing CLOSE message for client connection: ${connectionKey}`);
          const closeSubscriptionId = params[0];
          await this.unsubscribe(connectionKey, closeSubscriptionId);
          sendResponse(['NOTICE', 'Subscription closed']);
          logInfo(`handleMessage: Closed subscription ${closeSubscriptionId}`);
          break;
  
        default:
          logWarn(`handleMessage: Unknown message type: ${type}`);
          throw new Error('Unknown message type');
      }
    } catch (error) {
      logError('handleMessage: Error handling message:', error);
      sendResponse(['NOTICE', `Error: ${error.message}`]);
    }
  }
}

