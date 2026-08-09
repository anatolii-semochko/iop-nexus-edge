// Implementation notes for whoever builds this: uses the STM32_CAN
// library (pazi88/STM32_CAN on PlatformIO/Arduino Library Manager - see
// ../platformio.ini) for the F103's CAN1 peripheral (fixed hardware pins
// PA11 RX / PA12 TX, `DEF` pin mapping). UNTESTED against real hardware
// (see config.h's own header note) - this library's exact method names
// are written from its documented/typical usage, not verified against
// this specific board yet.

#include "can_bus.h"
#include "config.h"

#include <string.h>

#include <STM32_CAN.h>

static STM32_CAN can1(CAN1, DEF);

void canBusInit() {
  can1.begin();
  can1.setBaudRate(CAN_BITRATE);
}

bool canBusReceive(uint32_t id, uint8_t *outData, uint8_t *outLen) {
  CAN_message_t msg;
  // STM32_CAN buffers received frames internally - drain everything
  // pending this call, keeping only the one matching `id` (frames we
  // don't care about are simply discarded, this node has no other
  // receiver). If several PULSE frames queued up between loop()
  // iterations, the most recent one wins - fine, only arrival timing
  // matters, not which exact frame.
  bool found = false;
  while (can1.read(msg)) {
    if (msg.id == id) {
      uint8_t len = msg.len > 8 ? 8 : msg.len;
      for (uint8_t i = 0; i < len; i++) outData[i] = msg.buf[i];
      *outLen = len;
      found = true;
    }
  }
  return found;
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

void canSendBool(uint32_t id, bool value) {
  uint8_t buf[1] = {(uint8_t)(value ? 1 : 0)};
  sendFrame(id, buf, 1);
}

void canSendEnv(float temperatureC, float humidityPercent, bool hasHumidity) {
  uint8_t buf[8] = {0, 0, 0, 0, 0, 0, 0, 0};
  uint32_t tempBits;
  memcpy(&tempBits, &temperatureC, 4);
  buf[0] = (uint8_t)(tempBits);
  buf[1] = (uint8_t)(tempBits >> 8);
  buf[2] = (uint8_t)(tempBits >> 16);
  buf[3] = (uint8_t)(tempBits >> 24);

  if (hasHumidity) {
    uint32_t humidityBits;
    memcpy(&humidityBits, &humidityPercent, 4);
    buf[4] = (uint8_t)(humidityBits);
    buf[5] = (uint8_t)(humidityBits >> 8);
    buf[6] = (uint8_t)(humidityBits >> 16);
    buf[7] = (uint8_t)(humidityBits >> 24);
  }

  sendFrame(CAN_ID_ENV, buf, 8);
}

void canSendLeds(bool green, bool yellow, bool red) {
  uint8_t buf[3] = {(uint8_t)(green ? 1 : 0), (uint8_t)(yellow ? 1 : 0), (uint8_t)(red ? 1 : 0)};
  sendFrame(CAN_ID_LEDS, buf, 3);
}
