// Same STM32_CAN library and pattern as control-node's own can_bus.cpp -
// see that file's own header comment. This node never receives (pure
// sensor station, transmit-only), so there is no canBusReceive() here.
// UNTESTED against real hardware (config.h's own header note).

#include "can_bus.h"
#include "config.h"

#include <string.h>

#include <STM32_CAN.h>

static STM32_CAN can1(CAN1, DEF);

void canBusInit() {
  can1.begin();
  can1.setBaudRate(CAN_BITRATE);
}

static void sendFrame(uint32_t id, const uint8_t *data, uint8_t len) {
  CAN_message_t msg;
  msg.id = id;
  msg.len = len;
  for (uint8_t i = 0; i < len; i++) msg.buf[i] = data[i];
  can1.write(msg);
}

void canSendUint32(uint32_t id, uint32_t value) {
  uint8_t buf[4];
  buf[0] = (uint8_t)(value);
  buf[1] = (uint8_t)(value >> 8);
  buf[2] = (uint8_t)(value >> 16);
  buf[3] = (uint8_t)(value >> 24);
  sendFrame(id, buf, 4);
}

void canSendEnv(float temperatureC, float humidityPercent) {
  uint8_t buf[8];
  uint32_t tempBits;
  memcpy(&tempBits, &temperatureC, 4);
  buf[0] = (uint8_t)(tempBits);
  buf[1] = (uint8_t)(tempBits >> 8);
  buf[2] = (uint8_t)(tempBits >> 16);
  buf[3] = (uint8_t)(tempBits >> 24);

  uint32_t humidityBits;
  memcpy(&humidityBits, &humidityPercent, 4);
  buf[4] = (uint8_t)(humidityBits);
  buf[5] = (uint8_t)(humidityBits >> 8);
  buf[6] = (uint8_t)(humidityBits >> 16);
  buf[7] = (uint8_t)(humidityBits >> 24);

  sendFrame(CAN_ID_ENV, buf, 8);
}

void canSendPressure(float pressureHpa) {
  uint8_t buf[4];
  uint32_t bits;
  memcpy(&bits, &pressureHpa, 4);
  buf[0] = (uint8_t)(bits);
  buf[1] = (uint8_t)(bits >> 8);
  buf[2] = (uint8_t)(bits >> 16);
  buf[3] = (uint8_t)(bits >> 24);
  sendFrame(CAN_ID_PRESSURE, buf, 4);
}

void canSendLight(uint16_t rawLight) {
  uint8_t buf[2] = {(uint8_t)(rawLight), (uint8_t)(rawLight >> 8)};
  sendFrame(CAN_ID_LIGHT, buf, 2);
}
