// The platform's base tick/heartbeat period (AGENTS.md's Heartbeating
// Control section, confirmed with the user: "1 секунда... якщо буде
// потрібний швидший період - буде вирішуватися окремим кастомним
// сервісом"). A tiny, dependency-free module of its own (not defined in
// index.ts, which processes/heartbeatControl.ts would otherwise have to
// import back, cycling) - same reasoning as apps/api's
// processStateEvents.ts breaking its own circular-import risk the same
// way.
export const TICK_INTERVAL_MS = 1000;
