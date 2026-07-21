# PROJECT_MASTER.md

# Edge Automation Platform

## Version 1.1

---

# 1. Project Vision

Edge Automation Platform is an open-source, modular automation platform designed for building reliable automation systems across different domains.

The platform itself is not an application.

Smart House, Aquarium Automation, Industrial Automation, Marine Automation and other solutions are applications built on top of the platform.

The goal is to provide a reusable foundation for:

* IoT systems
* industrial automation
* legacy equipment modernization
* monitoring systems
* intelligent automation
* AI-assisted engineering solutions

---

# 2. Core Philosophy

## Edge First

The system must continue operating without cloud connectivity.

Cloud services are optional extensions.

The local system provides:

* device communication
* automation execution
* monitoring
* configuration
* diagnostics
* emergency handling
* user interface

---

## Local Control

Every deployment includes:

* local Node.js Orchestrator
* local React Interface

Cloud dashboards may extend functionality but must never become the only control mechanism.

---

## Reliability First

Automation systems prioritize:

* predictable behavior
* deterministic execution
* graceful degradation
* fault handling
* observability

AI is an additional capability and must not be a critical dependency.

---

# 3. Platform Architecture Model

The platform consists of:

* Core Runtime
* Device Abstraction Layer
* Event System
* Automation Engine
* Storage
* Security
* APIs
* UI Framework
* Extension System

Applications provide:

* domain logic
* workflows
* dashboards
* user scenarios
* custom device models

Examples:

* Smart House
* Aquarium Automation
* Greenhouse
* Solar Power
* Industrial Conveyor
* CNC Monitoring
* Warehouse Automation
* Yacht Automation
* Marine Monitoring

---

# 4. Architectural Principles

The system follows:

* Domain Driven Design
* Hexagonal Architecture
* Event Driven Architecture
* Plugin-based Extension Architecture

High-level architecture:

```
                Optional Cloud

                     |

             Local Edge System


        +------------------------+
        | React Local Interface  |
        +------------------------+

        +------------------------+
        | Node.js Orchestrator   |
        +------------------------+

        +------------------------+
        | Automation Services    |
        +------------------------+

        +------------------------+
        | Event Bus              |
        +------------------------+

        +------------------------+
        | Device API             |
        +------------------------+

        +------------------------+
        | EdgeX / Drivers        |
        +------------------------+

        Hardware:

        CAN
        RS485
        MQTT
        BLE
        IP Devices
        STM32 Nodes
```

---

# 5. Node.js Edge Orchestrator

The Orchestrator is the main runtime component.

Responsibilities:

* device lifecycle management
* command execution
* automation execution
* event processing
* plugin lifecycle management
* local API
* communication coordination

The Orchestrator contains business and automation logic.

It does not directly depend on hardware protocols.

---

# 6. Device Registry

Device Registry is a mandatory core subsystem.

It stores:

* device identity
* device type
* category
* location
* driver information
* configuration
* capabilities
* current state
* health information
* heartbeat information

Example:

```
Device:

ID:
aquarium.temp.sensor.01

Type:
AquariumTemperatureSensor

Driver:
DS18B20

Location:
Aquarium Room

Capabilities:

temperature.read
```

---

# 7. Device API

Device API is the internal domain abstraction of devices.

It separates application logic from hardware implementation.

Architecture:

```
Physical Device

      |

EdgeX / Driver Layer

      |

Device API

      |

Automation / AI
```

Responsibilities:

* device identity mapping
* normalization
* validation
* unit conversion
* adding domain context
* exposing capabilities

Example:

EdgeX data:

```json
{
  "device": "sensor01",
  "resource": "temperature",
  "value": 25.7
}
```

Device API model:

```json
{
  "type": "AquariumTemperatureSensor",
  "temperature": {
      "current": 25.7,
      "unit": "C"
  }
}
```

---

# 8. Digital Twin

Digital Twin is the software representation of a device.

Twin implements the same Device API interface as a physical device.

Purpose:

* simulation
* development without hardware
* automated testing
* diagnostics
* offline operation
* AI analysis

Twin contains:

* metadata
* current state
* capabilities
* commands
* configuration
* health information

Twin does NOT contain:

* automation rules
* business logic
* workflows
* safety policies

Those belong to:

* Orchestrator
* Automation Engine
* Application modules

Architecture:

Production:

```
Application

    |

Orchestrator

    |

Device API

    |

EdgeX

    |

Physical Device
```

Simulation:

```
Application

    |

Orchestrator

    |

Device API

    |

Digital Twin
```

---

# 9. Command API

Internal object model provides unified device operations.

Example:

```
device.temperature.getValue()

device.pump.start()

device.light.setBrightness(50)
```

Applications should not know:

* CAN identifiers
* MQTT topics
* Modbus registers
* hardware-specific details

---

# 10. Event Bus

Event Bus is the internal communication mechanism.

Purpose:

* reduce coupling;
* distribute events between modules;
* provide asynchronous communication.

Initial abstraction:

```ts
interface EventBus {

    publish(event): Promise<void>;

    subscribe(
        topic,
        handler
    ): Promise<Subscription>;

}
```

Implementation structure:

```
event-bus/

    memory/

    redis/

    rabbitmq/

    nats/
```

Development starts with:

```
InMemoryEventBus
```

Reasons:

* minimal complexity;
* fast development;
* easy testing;
* no external infrastructure.

Future implementations:

* RabbitMQ
* NATS
* Redis Streams
* custom distributed bus

---

# 11. Event Model

Events should contain metadata.

Example:

```json
{
  "id": "event-id",

  "topic":
  "device.temperature.changed",

  "timestamp":
  "2026-07-19T18:00:00Z",

  "source":
  "device-001",

  "payload":
  {
      "temperature": 25.4
  }
}
```

---

# 12. Plugin Architecture

Plugin architecture is used for extending the platform.

Plugin types:

* protocol plugins
* device drivers
* UI plugins
* storage plugins
* AI plugins
* notification plugins
* application modules

Every plugin defines:

* name
* version
* platform compatibility
* capabilities
* dependencies
* lifecycle hooks

---

# 13. Repository Strategy

The project uses:

* Monorepository
* pnpm workspace
* Turborepo

Structure:

```
apps/

packages/

plugins/

docs/

examples/

devices/
```

---

# 14. Driver SDK

Hardware communication is isolated.

Core system does not know hardware details.

Example:

```
Device API

      |

Driver SDK

      |

CAN / Modbus / MQTT

      |

Physical Device
```

Drivers provide:

* reading values
* sending commands
* discovery
* health monitoring

---

# 15. AI Integration Strategy

AI is an extension layer.

Core automation must work without AI.

AI capabilities:

* analysis
* recommendations
* anomaly detection
* optimization
* natural language interfaces

AI communicates through:

* Device API
* Event Bus
* Automation Layer

---

# 16. Technology Stack

## Backend

* Node.js LTS
* TypeScript
* Fastify
* Zod
* JWT
* Casbin / Permission Service
* PostgreSQL
* Redis
* RabbitMQ
* Pino

## Frontend

* React
* TypeScript
* Vite

## Communication

* MQTT
* WebSocket
* REST

## Infrastructure

* Linux
* Ubuntu
* Docker
* Docker Compose

## Embedded

Primary:

* STM32

Future:

* ESP32
* Raspberry Pi
* Linux gateways

---

# 17. Development Standards

Primary language:

TypeScript

Principles:

* modularity
* explicit contracts
* dependency inversion
* testability

Testing:

* Vitest
* Playwright
* Testing Library

---

# 18. EdgeX Foundry Reference

EdgeX Foundry is used as an architectural reference.

Adopted concepts:

* device services
* metadata
* command model
* event processing

The platform does not depend on EdgeX.

EdgeX is treated as:

```
Protocol / Hardware Abstraction Layer
```

The internal model remains:

```
device.temperature.getValue()

device.pump.start()

device.light.setBrightness(50)
```

---

# 19. Long-Term Goal

Create an open-source automation platform allowing engineers to build reliable intelligent systems from simple sensors to industrial automation environments.

The platform should become a foundation for:

* automation engineering
* AI-assisted systems
* legacy modernization
* embedded + cloud integration
* professional automation solutions

---

# End of PROJECT_MASTER.md v1.1

