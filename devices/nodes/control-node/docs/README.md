# Control Node

STM32 node mounted in the same enclosure as the Raspberry Pi running
NexusEdge, on the enclosure's own CAN bus. It has two independent jobs:
watch NexusEdge's own health (autonomously, entirely in firmware), and
be watched by NexusEdge in turn (through the platform's normal
Heartbeating Control). It also reports enclosure temperature/humidity.

## Hardware / devices (9 total)

| Device | What it is | Notes |
|---|---|---|
| LED Green / Yellow / Red | status LEDs | read-only mirrors - NexusEdge never drives them, only displays their firmware-decided state |
| Buzzer | passive buzzer | read-only mirror of "currently sounding" |
| Mute Beeper | momentary button | read-only mirror of "currently held" |
| Temperature | AHT10/AHT20 (I2C), or a DS18B20 (1-Wire) stand-in during early bring-up | DS18B20 has no humidity output |
| Humidity | AHT10/AHT20 only | absent entirely on a DS18B20-only instance |
| Pulse | writable Bool | written `true` every orchestrator tick |
| Heartbeat | free-running counter | incremented once/sec by firmware |

All LED/buzzer/reset escalation logic below runs 100% in firmware,
independent of NexusEdge - the whole point is it keeps signaling even
after NexusEdge itself has crashed. NexusEdge only ever reads these
back for display, it never commands them.

## Two independent heartbeat directions

- **Pulse** (NexusEdge -> node) confirms the control system itself is
  alive. Losing it drives the node's own autonomous escalation below.
- **Heartbeat** (node -> NexusEdge) confirms the node's own firmware/CAN
  link is alive, monitored the same way as any other node - Heartbeating
  Control watching this Device for staleness.

These are deliberately independent of each other - one direction
failing says nothing about the other.

## Autonomous escalation (firmware-only, not configurable from NexusEdge)

Once Pulse has arrived at least once ("launched"), the firmware tracks
time since the last Pulse:

- **< 2 seconds** - Green LED (pulses on for 100ms once/sec). Buzzer
  silent.
- **>= 2 seconds (Pulse lost)** - LED switches to alternating
  yellow/red. Buzzer escalates in stages, each timed from when Pulse
  was first lost:
  - **>= 1 minute** - short beep, 200ms on every 2 seconds.
  - **>= 2 minutes** - longer beep, 800ms on every second.
  - **>= 3 minutes** - continuous alarm, alternating between two tones
    with no silent gap.
- **Before the very first Pulse ever arrives (booting)** - Yellow LED
  blinks, buzzer stays silent, nothing else active yet.

Any real Pulse arriving resets everything back to normal in one step -
LED, buzzer stage, and the reset-attempt counter below all clear
together.

## Mute Beeper button

Silences the buzzer immediately, for the current outage only - it has
no effect on the LED state or on the reset schedule below. A fresh
Pulse loss afterward starts the buzzer escalation over from silent
again.

## Reset line

Independently of the buzzer schedule above, firmware attempts to reset
the Raspberry Pi up to three times: 5, 15, and 30 minutes after Pulse
was lost (each threshold measured from the same "Pulse lost" moment,
not from the previous attempt). After the third attempt it gives up
permanently for that outage - only a fresh Pulse resets the counter.

A separate, operator-installed mechanical switch gates whether the
reset line is actually wired through to the Pi's reset pins; firmware
never senses that switch's position and always runs its own schedule
regardless of it. To disable auto-reset entirely, leave that switch
open - don't rely on firmware to skip it.

## Configuring it (process detail, Processes page)

The `control-node` process's expandable row shows Temperature (and
Humidity, only when this instance actually has a humidity sensor
configured) as a live reading, each with four editable thresholds:
**Warning Min**, **Warning Max**, **Error Min**, **Error Max**. Both
directions matter here, unlike a plain CPU/RAM ceiling check - too cold
or too dry is as real a problem for an enclosure as too hot or too
humid. Any bound left unset simply isn't enforced on that side.

## Known limitations

- Firmware has been written but not yet build/flash-tested against
  real hardware.
- Stays `backend: virtual` until wired to a real CAN transceiver on the
  enclosure bus.
- A DS18B20-only bring-up instance has no humidity reading at all - the
  Humidity row simply doesn't appear for it.
- The reset-enable switch's position is a pure hardware gate - NexusEdge
  has no visibility into whether it's open or closed.
