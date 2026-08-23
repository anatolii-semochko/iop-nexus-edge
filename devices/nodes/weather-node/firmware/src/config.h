// All tunable values live here, same convention as
// `../../control-node/firmware/src/config.h` ("ВСІ часові таймери,
// затримки, частоти та інше ПРОПИШИ В КОНСТАНТИ!", AGENTS_TO_DO.md
// 2026-08-09, kept for every board built since).
//
// UNTESTED on real hardware as of writing (Node Weather Control.txt,
// AGENTS_TO_DO.md 2026-08-23 - components ordered, not yet arrived) -
// written against the STM32duino + PlatformIO toolchain, logic reasoned
// through but not yet build/flash-verified. See ../README.md before
// flashing.
#pragma once

// ---------------------------------------------------------------------
// Pin assignments (Blue Pill / STM32F103C8T6) - see ../README.md and
// ../../docs/wiring.md for the full schematic-in-text.
// ---------------------------------------------------------------------

// CAN1 uses fixed hardware pins PA11 (RX) / PA12 (TX) - not configurable.

// I2C1 (AHT20 + BMP280, shared bus) - default I2C1 pins.
#define PIN_I2C1_SCL PB6
#define PIN_I2C1_SDA PB7

// Photoresistor voltage-divider tap - ADC-capable pin.
#define PIN_LIGHT_ADC PA0

// ---------------------------------------------------------------------
// CAN bus - arbitration IDs and bus speed.
// ---------------------------------------------------------------------

// Matches control-node's own default - see ../../docs/wiring.md for the
// "own segment vs. shared bus" note; update if this node lands on a
// differently-rated segment.
#define CAN_BITRATE 500000

// 0x310-0x31F reserved for this node type (../../docs/wiring.md) -
// deliberately leaves 0x306-0x30F free for control-node's own possible
// future growth.
#define CAN_ID_HEARTBEAT 0x310  // node -> Raspberry (TX). Uint32, 4 bytes, free-running counter.
#define CAN_ID_ENV 0x311        // node -> Raspberry (TX). Temperature Float32 @ offset 0, Humidity Float32 @ offset 4.
#define CAN_ID_PRESSURE 0x312   // node -> Raspberry (TX). Pressure Float32 @ offset 0.
#define CAN_ID_LIGHT 0x313      // node -> Raspberry (TX). Raw light Uint16 @ offset 0.

// ---------------------------------------------------------------------
// Timing.
// ---------------------------------------------------------------------

// This node's own heartbeat - same 1Hz convention as control-node
// (matches apps/orchestrator's TICK_INTERVAL_MS).
#define HEARTBEAT_TX_INTERVAL_MS 1000

// AHT20/BMP280 datasheets: neither needs polling faster than ~1x/sec for
// a slow-changing ambient reading - same reasoning as control-node's own
// SENSOR_READ_INTERVAL_MS.
#define ENV_READ_INTERVAL_MS 2000

// Photoresistor has no conversion delay of its own (plain analogRead) -
// this interval just avoids flooding the bus with a fast-changing raw
// value nothing needs faster than this.
#define LIGHT_READ_INTERVAL_MS 1000

// ---------------------------------------------------------------------
// Sensor addresses.
// ---------------------------------------------------------------------

// AHT20 7-bit I2C address (fixed by the chip).
#define AHT_I2C_ADDRESS 0x38

// BMP280 7-bit I2C address - 0x76 (SDO low/floating, the common default)
// or 0x77 (SDO tied high) - check the specific breakout in hand, see
// ../../docs/wiring.md.
#define BMP280_I2C_ADDRESS 0x76
