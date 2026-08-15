## Purpose

Closes the renderer runtime bootstrap race behind the recurring `invalid token`
episode, removes the fallback endpoint that made an unregistered renderer retry
forever, and separates independently issued renderer runtimes.

## ADDED Requirements

### Requirement: The renderer runtime is issued before any window can request it
The main process SHALL register the local runtime endpoint and its
authentication token for a renderer before creating the window that will
request them. A request from an unregistered sender SHALL yield no runtime.
There SHALL be no default endpoint and no empty-token path: a renderer without
an issued runtime SHALL fail closed and state why, and SHALL make no connection
attempt.

#### Scenario: Window is created after registration
- **WHEN** a renderer window is created
- **THEN** its runtime endpoint and token are already registered and its synchronous preload request is answered with them

#### Scenario: Preload asks from an unregistered sender
- **WHEN** a preload requests the runtime from a sender that has no registration
- **THEN** no runtime is returned, no default endpoint is substituted, and the renderer presents a stated startup failure

#### Scenario: No fallback endpoint exists
- **WHEN** the application source is inspected for a default local endpoint or an empty-token connection path
- **THEN** none exists in the production graph

### Requirement: Authentication failure on the renderer transport is terminal
The renderer SHALL treat a rejected authentication token as a terminal
condition for its transport: it SHALL stop reconnecting, surface the failure
with a stated reason, and resume only on an explicit operator action or a newly
issued runtime. Transport losses that are not authentication failures SHALL
continue to reconnect.

#### Scenario: Token is rejected
- **WHEN** the local runtime rejects the renderer's token
- **THEN** the retry loop stops, one stated failure is surfaced, and no further connection attempt is made automatically

#### Scenario: Ordinary connection loss
- **WHEN** the transport closes without an authentication failure
- **THEN** reconnection continues as before

#### Scenario: A new runtime is issued
- **WHEN** a new runtime endpoint and token become available after a terminal authentication failure
- **THEN** the renderer may connect again

### Requirement: A runtime is addressable only by its own renderer
Each independently constructed renderer runtime SHALL receive its own endpoint
and token. A connection presenting a token that the receiving runtime did not
issue SHALL be refused.

#### Scenario: Independent runtimes exist concurrently
- **WHEN** two renderer runtimes are constructed with independently issued endpoint and token pairs
- **THEN** neither renderer can connect to the other's runtime

#### Scenario: A foreign token is presented
- **WHEN** a connection presents a token issued by a different runtime instance
- **THEN** the connection is refused and no market or account work is performed for it
