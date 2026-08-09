// All tunable values live here, per explicit instruction (AGENTS_TO_DO.md,
// 2026-08-09 "НОДА КОНТРОЛЮ": "ВСІ часові таймери, затримки, частоти та
// інше ПРОПИШИ В КОНСТАНТИ! Щоби легко можна було налаштовувати.") - one
// file, nothing hardcoded inline anywhere else in this firmware. A future
// `setConfig()` command (noted as a later step, not this pass) would
// overwrite these same values at runtime rather than replacing this file.
//
// This firmware is UNTESTED on real hardware as of writing (Blue Pills
// arrive the day after this was written - see AGENTS_TO_DO.md) - written
// against the STM32duino (Arduino core for STM32) + PlatformIO toolchain,
// logic carefully reasoned through but not yet build/flash-verified. See
// ../README.md before flashing.
#pragma once

// ---------------------------------------------------------------------
// Pin assignments (Blue Pill / STM32F103C8T6) - see ../README.md and
// ../../docs/wiring.md for the full schematic-in-text.
// ---------------------------------------------------------------------

// CAN1 uses fixed hardware pins PA11 (RX) / PA12 (TX) - not configurable,
// not listed as a #define for that reason (the STM32_CAN library binds to
// the peripheral, not arbitrary pins).

// I2C1 (AHT10/AHT20 environment sensor) - default I2C1 pins.
#define PIN_I2C1_SCL PB6
#define PIN_I2C1_SDA PB7

// DS18B20 (1-Wire) - temporary bring-up stand-in for AHT10/AHT20 before it
// arrives (temperature only, no humidity). Needs an external ~4.7kOhm
// pull-up resistor between this pin and 3.3V (1-Wire bus requirement, not
// provided by the MCU itself).
#define PIN_ONE_WIRE PB8

#define PIN_LED_GREEN PA0
#define PIN_LED_YELLOW PA1
#define PIN_LED_RED PA2

// Passive buzzer - PWM tone output. PA3 is TIM2_CH4 on the F103, capable
// of hardware PWM (needed for the two-tone stage-3 alarm, not just on/off).
#define PIN_BUZZER PA3

// Momentary "Mute Beeper" button, normally-open, wired to GND - internal
// pull-up enabled in software, so a press reads LOW.
#define PIN_MUTE_BUTTON PA4

// Drives the *node's own side* of the CurrentNodeResetContact <->
// RaspberryResetContact line (AGENTS_TO_DO.md, 2026-08-09) - a HIGH pulse
// here only actually reaches the Raspberry's reset pins if the operator's
// own mechanical enable switch is closed; this firmware never senses that
// switch's state and always attempts the pulse regardless (confirmed with
// the user: "Прошивка завжди намагається reset, стан перемикача не
// сенсимо").
#define PIN_RESET_OUTPUT PA5

// ---------------------------------------------------------------------
// CAN bus - arbitration IDs and bus speed.
// ---------------------------------------------------------------------

// Classic CAN, 500 kbps - a common default for a short in-enclosure bus;
// revisit once the real bus (shared with other nodes, per the enclosure's
// existing CAN wiring - AGENTS_TO_DO.md, 2026-08-09) has a documented
// project-wide bit rate to match instead.
#define CAN_BITRATE 500000

// One arbitration ID per resource, matching apps/device-service's own CAN
// mapping convention (canId + byteOffset attributes on the EdgeX device
// profile - devices/standalone/*/edgex-device-profile.yaml). IDs in the
// 0x300-0x30F block are reserved for this node type; pick a different,
// documented block if a second control-node-type instance ever shares a
// bus with this one.
#define CAN_ID_PULSE 0x300      // Raspberry -> node (RX here). Bool, 1 byte. Value irrelevant, only arrival matters.
#define CAN_ID_HEARTBEAT 0x301  // node -> Raspberry (TX here). Uint32, 4 bytes, free-running counter.
#define CAN_ID_ENV 0x302        // node -> Raspberry (TX here). Temperature Float32 @ offset 0, Humidity Float32 @ offset 4.
#define CAN_ID_LEDS 0x303       // node -> Raspberry (TX here, mirror only). Green Bool @0, Yellow Bool @1, Red Bool @2.
#define CAN_ID_BUZZER 0x304     // node -> Raspberry (TX here, mirror only). Bool, 1 byte.
#define CAN_ID_BUTTON 0x305     // node -> Raspberry (TX here, mirror only). Bool, 1 byte - live Mute Beeper state.

// ---------------------------------------------------------------------
// Pulse watchdog timing (AGENTS_TO_DO.md, 2026-08-09 - fully specified
// there after several rounds of Q&A, reproduced here verbatim as
// constants).
// ---------------------------------------------------------------------

// Expected cadence of CAN_ID_PULSE frames from NexusEdge, once/sec -
// matches apps/orchestrator's own TICK_INTERVAL_MS (1000ms) and the
// System Tick indicator's own pulse rate (nexus-edge AGENTS.md section
// 36), by design - this firmware's "pulse" *is* that same tick, carried
// over CAN.
#define PULSE_EXPECTED_INTERVAL_MS 1000

// Single shared "time since last valid pulse" clock drives every
// threshold below (confirmed with the user: "починаємо рахувати час
// відсутності пульсу після першого пропуску" - the clock is just
// `now - lastPulseAt`, continuously, not a separate counter restarted at
// each stage). ">2s, alarm on the 3rd missed beat" - two full expected
// periods must have elapsed with nothing received.
#define PULSE_LOST_THRESHOLD_MS 2000

// Buzzer escalation stages, each measured from the SAME lastPulseAt clock
// as PULSE_LOST_THRESHOLD_MS above (not from each other) - user's own
// spec: ">2с -> блимання, +1хв -> короткий біп, +1хв (=2хв) -> довгий,
// +1хв (=3хв) -> постійний двочастотний".
#define BUZZER_STAGE_SHORT_BEEP_MS 60000    // 1 minute
#define BUZZER_STAGE_LONG_BEEP_MS 120000    // 2 minutes
#define BUZZER_STAGE_CONTINUOUS_MS 180000   // 3 minutes

// Forced-reset attempts, also measured from the same lastPulseAt clock -
// user's own spec: "5, 15, 30 хвилин від останнього пульсу оркестратора",
// only once launched == true. The growing gaps between attempts (10min,
// then 15min) are themselves the "let it finish booting" buffer for each
// subsequent attempt - confirmed reasonable by Claude, accepted by user
// 2026-08-09.
#define RESET_ATTEMPT_1_MS 300000   // 5 minutes
#define RESET_ATTEMPT_2_MS 900000   // 15 minutes
#define RESET_ATTEMPT_3_MS 1800000  // 30 minutes
#define RESET_MAX_ATTEMPTS 3
// After the 3rd attempt, this firmware stops trying (treats it as a
// hardware fault) and never resets the attempt counter until a real pulse
// returns - user's own spec: "Після третьої спроби нічого не робимо,
// зупиняємося."

// How long the reset-output pin is held HIGH for one attempt - a brief
// pulse, not a sustained level (matches typical reset-line behavior; long
// enough to register, short enough not to look like a stuck line).
#define RESET_PULSE_DURATION_MS 250

// ---------------------------------------------------------------------
// LED timing.
// ---------------------------------------------------------------------

// Green (pulse present): pulses in time with the incoming CAN_ID_PULSE
// frame, same period/on-duration as the UI's own System Tick dot
// (apps/ui/src/scss/style.scss's `.system-tick-pulse`, shortened
// 2026-08-09 from 450ms to 100ms specifically so this firmware could
// reuse the exact same value - AGENTS_TO_DO.md, "Довжину світіння
// імпульсу візьми звідти (UI)").
#define LED_GREEN_PULSE_PERIOD_MS 1000
#define LED_GREEN_PULSE_ON_MS 100

// Yellow (booting - launched == false, no pulse ever received yet): a
// plain steady blink, not tied to any external event since there is
// nothing to time off of yet. Rate not specified by the user beyond
// "блимає" - defaulting to a comfortable 1Hz/50% duty, easy to retune.
#define LED_YELLOW_BOOT_BLINK_PERIOD_MS 1000

// Yellow/Red alternating (launched == true, pulse lost): rate not given
// an explicit number either - defaulting to a brisk 2Hz alternation
// (500ms each) so it reads as clearly more urgent than the boot blink
// above.
#define LED_YELLOW_RED_ALTERNATE_PERIOD_MS 500

// ---------------------------------------------------------------------
// Buzzer tone/timing profile.
// ---------------------------------------------------------------------

// Stage "short beep" (BUZZER_STAGE_SHORT_BEEP_MS): user's own spec -
// "короткий beep раз в дві секунди". On-duration reuses the platform's
// own short-beep default (message_signal_timing seed, AGENTS.md section
// 42, apps/api/migrations) for consistency across hardware/software
// alarm surfaces, not picked independently.
// Tone used for both the short-beep and long-beep stages - a single
// mid-range frequency, distinct from the two-tone stage-3 alarm below so
// the escalation is audibly recognizable as a different, later stage.
#define BEEP_TONE_HZ 2500

#define BEEP_SHORT_ON_MS 200
#define BEEP_SHORT_PERIOD_MS 2000

// Stage "long beep" (BUZZER_STAGE_LONG_BEEP_MS): user's own spec -
// "довгий beep раз в одну секунду". On-duration reuses the same
// platform-wide long-beep default as above.
#define BEEP_LONG_ON_MS 800
#define BEEP_LONG_PERIOD_MS 1000

// Stage "continuous two-tone" (BUZZER_STAGE_CONTINUOUS_MS): user's own
// spec - "постійний beep почергово двома частотами 1-2-1-2-1-2 шість
// змін в секунду" - 6 tone changes/sec = a new tone every ~167ms, no
// silence between them (this stage is deliberately relentless).
#define BEEP_ALARM_TONE_1_HZ 2000
#define BEEP_ALARM_TONE_2_HZ 3000
#define BEEP_ALARM_TONE_SWITCH_MS 167

// ---------------------------------------------------------------------
// Misc.
// ---------------------------------------------------------------------

// Mute Beeper button debounce - short, it's a simple momentary switch,
// not a noisy sensor.
#define MUTE_BUTTON_DEBOUNCE_MS 30

// This node's own heartbeat (CAN_ID_HEARTBEAT) increments and
// transmits at the same rate as the expected incoming pulse - see
// devices/standalone/sensor/heartbeat/contract.schema.ts for why the
// *value* itself is meaningless and only change-over-time matters to
// the reader (apps/orchestrator, via nexus-edge-aquarium's own
// plugins/control-node/process.ts).
#define HEARTBEAT_TX_INTERVAL_MS 1000

// Rate limit for the LED/buzzer/button *mirror* frames (CAN_ID_LEDS/
// CAN_ID_BUZZER/CAN_ID_BUTTON) - these are read-only state broadcasts for
// NexusEdge-side visibility, not part of any control loop, so there is no
// reason to send them every loop() iteration (which would run far faster
// than anything actually needs and needlessly load the shared bus).
// Shares HEARTBEAT_TX_INTERVAL_MS's own cadence rather than a separate
// constant - 1Hz is plenty responsive for a background status mirror.
#define MIRROR_TX_INTERVAL_MS HEARTBEAT_TX_INTERVAL_MS

// AHT10/AHT20 I2C 7-bit address (both chips share this address - the
// AHT20 is the AHT10's pin/register-compatible successor).
#define AHT_I2C_ADDRESS 0x38

// Which physical sensor is actually wired up right now - a compile-time
// choice, not runtime-detected (AGENTS_TO_DO.md, 2026-08-09: "на даний
// момент у мене тільки жменька DS18B20 для тестів", target hardware is
// AHT10/AHT20). Comment out to build for DS18B20 (temperature-only,
// 1-Wire) instead - see sensor.cpp.
#define SENSOR_USE_AHT 1

// How often the sensor is actually read - both chips are slow-changing
// physical readings and AHT10/AHT20's own datasheet recommends not
// polling faster than ~1x/sec; DS18B20's own conversion time is ~750ms
// at 12-bit resolution, so this interval comfortably covers either.
#define SENSOR_READ_INTERVAL_MS 2000
