import * as dbus from "dbus-next";

import { config } from "./config.js";

// Service->Commands (AGENTS_TO_DO.md, 2026-08-30) - host power commands via
// a D-Bus call to systemd-logind on the HOST bus (docker-compose.yml mounts
// /run/dbus/system_bus_socket into this container read-write). Deliberately
// NOT child_process('shutdown -h now') - that would at most affect this
// container's own PID namespace, never the real host the container runs on.

export interface SystemCommandDef {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

export function listSystemCommands(): SystemCommandDef[] {
  return [
    {
      id: "shutdown",
      label: "Shutdown",
      description: "Power off the host machine this stack runs on.",
      enabled: config.service.shutdownEnabled,
    },
    {
      id: "restart",
      label: "Restart",
      description: "Reboot the host machine this stack runs on.",
      enabled: config.service.restartEnabled,
    },
  ];
}

// org.freedesktop.login1.Manager's PowerOff/Reboot both take one boolean
// arg - "interactive": whether logind may prompt a polkit auth dialog on a
// wired-up desktop session instead of just acting or refusing outright. This
// process never has a session to show that dialog in, so always false - a
// refusal (e.g. polkit denies it) should surface as a normal error, not
// hang waiting on a prompt nobody can answer.
async function callLogind(method: "PowerOff" | "Reboot"): Promise<void> {
  const bus = dbus.systemBus();
  try {
    const proxy = await bus.getProxyObject("org.freedesktop.login1", "/org/freedesktop/login1");
    const manager = proxy.getInterface("org.freedesktop.login1.Manager");
    await manager[method](false);
  } finally {
    bus.disconnect();
  }
}

export async function runSystemCommand(id: string): Promise<void> {
  const commands = listSystemCommands();
  const command = commands.find((c) => c.id === id);
  if (!command) {
    throw new Error(`Unknown system command: ${id}`);
  }
  if (!command.enabled) {
    throw new Error(`System command is disabled: ${id}`);
  }
  if (id === "shutdown") {
    await callLogind("PowerOff");
    return;
  }
  if (id === "restart") {
    await callLogind("Reboot");
    return;
  }
  throw new Error(`Unhandled system command: ${id}`);
}
