import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger, format, transports } from "winston";
import type { Logger } from "winston";

const ROOT_LOGGER_NAME = "root";
const KNOWN_LEVELS = new Set([
  "error",
  "warn",
  "info",
  "http",
  "verbose",
  "debug",
  "silly",
]);

const configuredLogger = createLogger({
  level: "info",
  exitOnError: false,
  transports: [],
});

function normalizeLogLevel(logLevel: string): string {
  const normalizedLevel = logLevel.trim().toLowerCase();

  if (normalizedLevel === "warning") {
    return "warn";
  }

  return KNOWN_LEVELS.has(normalizedLevel) ? normalizedLevel : "info";
}

function buildLogFormat() {
  return format.combine(
    format.errors({ stack: true }),
    format.splat(),
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.printf((info) => {
      const loggerName =
        typeof info.loggerName === "string"
          ? info.loggerName
          : ROOT_LOGGER_NAME;
      const renderedMessage =
        typeof info.stack === "string" ? info.stack : String(info.message);
      return `${info.timestamp} [${info.level.toUpperCase().padEnd(8, " ")}] ${loggerName}: ${renderedMessage}`;
    }),
  );
}

function clearTransports(logger: Logger): void {
  for (const transport of [...logger.transports]) {
    logger.remove(transport);
    transport.close?.();
  }
}

/** Configure the shared application logger once at startup and replace prior transports on re-init. */
export function setupLogging(logLevel = "INFO", logFile?: string): Logger {
  clearTransports(configuredLogger);

  const activeTransports: Logger["transports"] = [new transports.Console()];
  if (logFile) {
    mkdirSync(dirname(logFile), { recursive: true });
    activeTransports.push(
      new transports.File({
        filename: logFile,
      }),
    );
  }

  configuredLogger.configure({
    level: normalizeLogLevel(logLevel),
    exitOnError: false,
    format: buildLogFormat(),
    transports: activeTransports,
  });

  return configuredLogger;
}

/** Return a named logger that writes through the shared configured transports without reconfiguring them. */
export function getLogger(loggerName = ROOT_LOGGER_NAME): Logger {
  if (loggerName === ROOT_LOGGER_NAME) {
    return configuredLogger;
  }

  return configuredLogger.child({ loggerName });
}
