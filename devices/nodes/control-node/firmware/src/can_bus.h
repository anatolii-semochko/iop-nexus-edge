// Thin wrapper around the STM32_CAN library (pazi88/STM32_CAN, the
// de-facto standard classic-CAN driver for STM32duino's bxCAN peripheral
// on F1-series parts) - isolates the rest of this firmware from that
// library's own API shape, and gives one place to change bus speed/
// filtering if that library's interface ever changes.
//
// Byte layout for every frame matches apps/device-service's own
// little-endian CAN codec exactly (internal/transport/can/codec.go) -
// canId/byteOffset attributes on a real (non-virtual) EdgeX device
// profile would read these frames correctly with no translation.
#pragma once

#include <stdint.h>

void canBusInit();

// Non-blocking - true and fills outData/outLen if a frame with the given
// id was received since the last poll. Only CAN_ID_PULSE is ever
// received by this node (see config.h) - its payload is never inspected,
// only its arrival matters (see main.cpp).
bool canBusReceive(uint32_t id, uint8_t *outData, uint8_t *outLen);

// Single-value telemetry frames (CAN_ID_HEARTBEAT, CAN_ID_BUZZER,
// CAN_ID_BUTTON - see config.h) - fire-and-forget, no peer ACK awaited
// beyond what the CAN hardware itself guarantees.
void canSendUint32(uint32_t id, uint32_t value);
void canSendBool(uint32_t id, bool value);

// CAN_ID_ENV packs two Float32 fields (temperature @ byte offset 0,
// humidity @ byte offset 4) into one 8-byte frame - sent as a single
// frame, not two separate sends, since two sends to the same id would
// just overwrite each other on the receive side's own "latest frame per
// id" cache (apps/device-service's busConn.go). `hasHumidity` false
// zero-fills the humidity field and the reader (nexus-edge-aquarium's
// plugins/control-node/process.ts, via its own humidityDeviceId being
// absent for a DS18B20-only bring-up instance) simply never reads it.
void canSendEnv(float temperatureC, float humidityPercent, bool hasHumidity);

// CAN_ID_LEDS packs three Bool fields (green @0, yellow @1, red @2) -
// same one-frame reasoning as canSendEnv above. Mirror-only: NexusEdge
// never writes to this id, it only ever reads the state this firmware
// already autonomously decided (see led_state.h).
void canSendLeds(bool green, bool yellow, bool red);
